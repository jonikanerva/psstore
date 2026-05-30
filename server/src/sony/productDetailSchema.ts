import { Either, Schema } from 'effect'

/**
 * Effect Schema boundary schema for Sony's `data.productRetrieve` node
 * (operation `metGetProductById`).
 *
 * Deliberately tolerant (STACK.md scope-at-the-boundary; this is a DEFENSIVE
 * boundary, not the scope filter): every field is optional and unknown keys are
 * preserved (`onExcessProperty: "preserve"`, the Effect equivalent of the
 * previous zod `z.looseObject`), so a Sony shape change degrades to empty
 * description / genres rather than throwing and failing the request. Only the
 * fields the PDP enrichment reads are described. Do NOT tighten this — see
 * devils-advocate correction #6.
 */
const sonyDescriptionSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  subType: Schema.optional(Schema.NullOr(Schema.String)),
  value: Schema.optional(Schema.String),
})

const sonyLocalizedGenreSchema = Schema.Struct({
  value: Schema.optional(Schema.String),
})

export const productRetrieveSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  releaseDate: Schema.optional(Schema.String),
  publisherName: Schema.optional(Schema.String),
  storeDisplayClassification: Schema.optional(Schema.String),
  descriptions: Schema.optional(Schema.Array(sonyDescriptionSchema)),
  combinedLocalizedGenres: Schema.optional(
    Schema.Array(sonyLocalizedGenreSchema),
  ),
})

export type ProductRetrieveNode = typeof productRetrieveSchema.Type

const decode = Schema.decodeUnknownEither(productRetrieveSchema, {
  onExcessProperty: 'preserve',
})

/**
 * Parse the `productRetrieve` node defensively. Returns the validated node, or
 * `null` when the payload is missing or malformed — callers degrade to empty
 * values rather than surfacing a transport-level failure to the user.
 */
export const parseProductRetrieve = (
  node: unknown,
): ProductRetrieveNode | null => {
  if (node === null || node === undefined) {
    return null
  }

  const result = decode(node)
  return Either.isRight(result) ? result.right : null
}
