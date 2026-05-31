import { Either, Schema } from 'effect'

/**
 * Effect Schema boundary schema for Sony's `data.categoryGridRetrieve` node
 * (operation `categoryGridRetrieve`, used by the NEW / UPCOMING / DISCOUNTED
 * list features).
 *
 * Deliberately tolerant (STACK.md scope-at-the-boundary; this is a DEFENSIVE
 * boundary, not the scope filter), mirroring `productDetailSchema.ts`: every
 * field is optional and unknown keys are preserved (`onExcessProperty:
 * "preserve"`, the Effect equivalent of the previous loose object), so a Sony
 * shape change degrades to an empty list rather than corrupting the cache or
 * throwing. Only the fields the list mapper reads are described. Do NOT tighten
 * this — see the PDP precedent (devils-advocate correction #6).
 */
const mediaSchema = Schema.Struct({
  url: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
})

const conceptPriceSchema = Schema.Struct({
  basePrice: Schema.optional(Schema.String),
  discountedPrice: Schema.optional(Schema.String),
  discountText: Schema.optional(Schema.NullOr(Schema.String)),
  serviceBranding: Schema.optional(Schema.Array(Schema.String)),
  upsellServiceBranding: Schema.optional(Schema.Array(Schema.String)),
  upsellText: Schema.optional(Schema.NullOr(Schema.String)),
})

const conceptProductRefSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  releaseDate: Schema.optional(Schema.String),
  providerName: Schema.optional(Schema.String),
  genres: Schema.optional(Schema.Array(Schema.String)),
})

const conceptSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  media: Schema.optional(Schema.Array(mediaSchema)),
  price: Schema.optional(conceptPriceSchema),
  products: Schema.optional(Schema.Array(conceptProductRefSchema)),
})

const categoryGridProductSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  media: Schema.optional(Schema.Array(mediaSchema)),
  price: Schema.optional(conceptPriceSchema),
  platforms: Schema.optional(Schema.Array(Schema.String)),
  storeDisplayClassification: Schema.optional(Schema.String),
  npTitleId: Schema.optional(Schema.String),
})

export const categoryGridRetrieveSchema = Schema.Struct({
  concepts: Schema.optional(Schema.Array(conceptSchema)),
  products: Schema.optional(Schema.Array(categoryGridProductSchema)),
})

/**
 * The decoded `categoryGridRetrieve` node and its element shapes. These are the
 * single source of truth for the category-grid value types: `types.ts`
 * re-exports them under the canonical `Concept` / `CategoryGridProduct` / `Media`
 * / `ConceptPrice` / `ConceptProductRef` names, so the decoder and the value
 * types can never drift (a mismatch is a compile error — STACK.md §2). Consumers
 * read them through the `readonly`-tolerant mapper signatures
 * (`mapConceptsToGames` already takes `readonly Concept[]`).
 */
export type CategoryGridNode = typeof categoryGridRetrieveSchema.Type
export type Media = typeof mediaSchema.Type
export type ConceptPrice = typeof conceptPriceSchema.Type
export type ConceptProductRef = typeof conceptProductRefSchema.Type
export type Concept = typeof conceptSchema.Type
export type CategoryGridProduct = typeof categoryGridProductSchema.Type

const decode = Schema.decodeUnknownEither(categoryGridRetrieveSchema, {
  onExcessProperty: 'preserve',
})

/**
 * Parse the `categoryGridRetrieve` node defensively. Returns the validated node,
 * or `null` when the payload is malformed — the caller distinguishes a genuine
 * drift (log a warning, degrade to an empty list) from an absent node; see
 * `extractCategoryGrid` in sonyClient.ts.
 */
export const parseCategoryGrid = (node: unknown): CategoryGridNode | null => {
  if (node === null || node === undefined) {
    return null
  }

  const result = decode(node)
  return Either.isRight(result) ? result.right : null
}

/**
 * Zero-cast envelope decode for the category-grid response. Mirrors the shape
 * `{ data?: { categoryGridRetrieve?: unknown } }` defensively (all optional,
 * excess preserved) so the untrusted body is narrowed before the inner node is
 * read — replacing the previous `as CategoryGridRetrieveResponse` cast.
 *
 * Returns the inner `categoryGridRetrieve` value as `unknown` (or `undefined`
 * when absent / the body is not an object); the caller hands it to
 * `parseCategoryGrid`.
 */
const envelopeSchema = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      categoryGridRetrieve: Schema.optional(Schema.Unknown),
    }),
  ),
})

const decodeEnvelope = Schema.decodeUnknownEither(envelopeSchema, {
  onExcessProperty: 'preserve',
})

export const extractCategoryGridNode = (json: unknown): unknown => {
  const result = decodeEnvelope(json)
  return Either.isRight(result)
    ? result.right.data?.categoryGridRetrieve
    : undefined
}
