import type { PlusOffer } from '@psstore/shared'
import { Result, Schema } from 'effect'

/**
 * Tolerant boundary schema for Sony's `data.productRetrieve` node of the
 * price operation. Every field is `optional(NullOr(...))` and unknown keys are
 * ignored. `webctas` decodes as an unknown list so one malformed entry never
 * drops the others.
 */
const ctaPriceSchema = Schema.Struct({
  applicability: Schema.optional(Schema.NullOr(Schema.String)),
  basePrice: Schema.optional(Schema.NullOr(Schema.String)),
  displayDiscountText: Schema.optional(Schema.NullOr(Schema.String)),
  discountedPrice: Schema.optional(Schema.NullOr(Schema.String)),
  isTiedToSubscription: Schema.optional(Schema.NullOr(Schema.Boolean)),
  serviceBranding: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.NullOr(Schema.String))),
  ),
})

const ctaSchema = Schema.Struct({
  type: Schema.optional(Schema.NullOr(Schema.String)),
  price: Schema.optional(Schema.NullOr(ctaPriceSchema)),
})

const productPriceNodeSchema = Schema.Struct({
  webctas: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
})

const envelopeSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        productRetrieve: Schema.optional(Schema.NullOr(Schema.Unknown)),
      }),
    ),
  ),
})

const decodeEnvelope = Schema.decodeUnknownResult(envelopeSchema)
const decodeNode = Schema.decodeUnknownResult(productPriceNodeSchema)
const decodeCta = Schema.decodeUnknownResult(ctaSchema)

const PS_PLUS = 'PS_PLUS'

// CTA types for which Sony includes the game in a PS Plus tier: the Extra game
// catalog, a free PS Plus game, and the Premium Classics. A trial or any
// future tied type is not "included" and maps to no offer.
const INCLUDED_CTA_TYPES: ReadonlySet<string> = new Set([
  'UPSELL_PS_PLUS_GAME_CATALOG',
  'UPSELL_PS_PLUS_FREE',
  'UPSELL_PS_PLUS_CLASSIC_GAME_COLLECTION',
])

type Cta = typeof ctaSchema.Type

const offerFromCta = (cta: Cta): PlusOffer | null => {
  const price = cta.price
  if (
    price?.applicability !== 'UPSELL' ||
    price.serviceBranding?.includes(PS_PLUS) !== true
  ) {
    return null
  }

  if (price.isTiedToSubscription === true) {
    return cta.type !== null &&
      cta.type !== undefined &&
      INCLUDED_CTA_TYPES.has(cta.type)
      ? { kind: 'included' }
      : null
  }

  const discounted = price.discountedPrice
  return price.isTiedToSubscription === false &&
    discounted !== null &&
    discounted !== undefined &&
    discounted.trim().length > 0
    ? { kind: 'price', price: discounted }
    : null
}

/**
 * The standard (non-subscription) price of a product, as Sony's verbatim
 * strings. An absent value is the empty string.
 */
export interface StandardPrice {
  readonly basePrice: string
  readonly discountedPrice: string
  readonly discountText: string
}

export interface ProductPrice {
  readonly plusOffer: PlusOffer | null
  readonly standard: StandardPrice | null
}

const text = (value: string | null | undefined): string => value ?? ''

const standardFromCta = (cta: Cta): StandardPrice | null => {
  const price = cta.price
  if (
    price === null ||
    price === undefined ||
    price.applicability === 'UPSELL' ||
    price.isTiedToSubscription === true
  ) {
    return null
  }

  const standard: StandardPrice = {
    basePrice: text(price.basePrice),
    discountedPrice: text(price.discountedPrice),
    discountText: text(price.displayDiscountText),
  }
  return standard.basePrice === '' && standard.discountedPrice === ''
    ? null
    : standard
}

const decodedCtas = (json: unknown): readonly Cta[] => {
  const envelope = decodeEnvelope(json)
  const node = Result.isSuccess(envelope)
    ? envelope.success.data?.productRetrieve
    : null
  if (node === null || node === undefined) {
    return []
  }

  const decoded = decodeNode(node)
  if (Result.isFailure(decoded)) {
    return []
  }

  return (decoded.success.webctas ?? []).flatMap((entry) => {
    const cta = decodeCta(entry)
    return Result.isSuccess(cta) ? [cta.success] : []
  })
}

/**
 * Derive the PS Plus offer and the standard price from a full GraphQL
 * response body. The standard price is the first CTA that is neither a
 * subscription upsell nor tied to a subscription. A missing or malformed node
 * gives no offer and no standard price.
 */
export const parseProductPrice = (json: unknown): ProductPrice => {
  const ctas = decodedCtas(json)
  return {
    plusOffer: ctas.map(offerFromCta).find((offer) => offer !== null) ?? null,
    standard: ctas.map(standardFromCta).find((price) => price !== null) ?? null,
  }
}

/**
 * Derive the PS Plus offer from a full GraphQL response body. Returns `null`
 * for a missing or malformed `data.productRetrieve` node and when no CTA is a
 * PS Plus offer. The price text is Sony's string, never recomputed.
 */
export const parsePlusOffer = (json: unknown): PlusOffer | null =>
  parseProductPrice(json).plusOffer
