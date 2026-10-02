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

// CTA types for which Sony includes the game in a PS Plus tier. A trial or any
// future tied type is not "included" and maps to no offer.
const INCLUDED_CTA_TYPES: ReadonlySet<string> = new Set([
  'UPSELL_PS_PLUS_GAME_CATALOG',
  'UPSELL_PS_PLUS_FREE',
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
 * Derive the PS Plus offer from a full GraphQL response body. Returns `null`
 * for a missing or malformed `data.productRetrieve` node and when no CTA is a
 * PS Plus offer. The price text is Sony's string, never recomputed.
 */
export const parsePlusOffer = (json: unknown): PlusOffer | null => {
  const envelope = decodeEnvelope(json)
  const node = Result.isSuccess(envelope)
    ? envelope.success.data?.productRetrieve
    : null
  if (node === null || node === undefined) {
    return null
  }

  const decoded = decodeNode(node)
  if (Result.isFailure(decoded)) {
    return null
  }

  for (const entry of decoded.success.webctas ?? []) {
    const cta = decodeCta(entry)
    if (Result.isSuccess(cta)) {
      const offer = offerFromCta(cta.success)
      if (offer !== null) {
        return offer
      }
    }
  }

  return null
}
