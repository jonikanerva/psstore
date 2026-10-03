import { Result, Schema } from 'effect'
import { isValidProductId } from '../domain/listing.js'

/**
 * Tolerant boundary schema for the concept lookup. The result is the product id
 * Sony sells for the concept today: the default product, else the first product.
 * Anything else, including Sony's "Concept not available" error, gives `null`.
 */
const productRef = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
})

const envelopeSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        conceptRetrieve: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              defaultProduct: Schema.optional(Schema.NullOr(productRef)),
              products: Schema.optional(
                Schema.NullOr(Schema.Array(Schema.Unknown)),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
})

const decodeEnvelope = Schema.decodeUnknownResult(envelopeSchema)
const decodeProductRef = Schema.decodeUnknownResult(productRef)

export const parseConceptProductId = (json: unknown): string | null => {
  const envelope = decodeEnvelope(json)
  if (Result.isFailure(envelope)) {
    return null
  }

  const concept = envelope.success.data?.conceptRetrieve
  if (concept === null || concept === undefined) {
    return null
  }

  const candidates = [concept.defaultProduct, ...(concept.products ?? [])]
  for (const candidate of candidates) {
    const decoded = decodeProductRef(candidate)
    const id = Result.isSuccess(decoded) ? decoded.success.id : null
    if (typeof id === 'string' && isValidProductId(id)) {
      return id
    }
  }
  return null
}
