import { Result, Schema } from 'effect'
import { mediaSchema } from './categoryGridSchema.js'

/**
 * Effect Schema boundary schema for Sony's `data.productRetrieve` node
 * (operation `metGetProductById`).
 *
 * Deliberately tolerant (STACK.md scope-at-the-boundary; this is a DEFENSIVE
 * boundary, not the scope filter): every field is `optional(NullOr(...))` — it
 * accepts an absent key, an explicit `null`, OR the typed value — and unknown
 * keys are ignored, never an error. Sony sends `null` liberally; a plain
 * `optional` rejects a present `null`, and because `Schema.Array` fails
 * wholesale on one bad element a single null-bearing entry would fail the
 * whole decode. A failed PDP decode degrades quietly to empty
 * description/genres via the productDetailCache catch. Only the fields the PDP
 * enrichment reads are described. Do NOT tighten this.
 */
const sonyDescriptionSchema = Schema.Struct({
  type: Schema.optional(Schema.NullOr(Schema.String)),
  subType: Schema.optional(Schema.NullOr(Schema.String)),
  value: Schema.optional(Schema.NullOr(Schema.String)),
})

const sonyLocalizedGenreSchema = Schema.Struct({
  value: Schema.optional(Schema.NullOr(Schema.String)),
})

export const productRetrieveSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  media: Schema.optional(Schema.NullOr(Schema.Array(mediaSchema))),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  publisherName: Schema.optional(Schema.NullOr(Schema.String)),
  storeDisplayClassification: Schema.optional(Schema.NullOr(Schema.String)),
  platforms: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  descriptions: Schema.optional(
    Schema.NullOr(Schema.Array(sonyDescriptionSchema)),
  ),
  combinedLocalizedGenres: Schema.optional(
    Schema.NullOr(Schema.Array(sonyLocalizedGenreSchema)),
  ),
})

export type ProductRetrieveNode = typeof productRetrieveSchema.Type

const decode = Schema.decodeUnknownResult(productRetrieveSchema)

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
  return Result.isSuccess(result) ? result.success : null
}
