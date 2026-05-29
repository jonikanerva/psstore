import { z } from 'zod'

/**
 * Zod boundary schema for Sony's `data.productRetrieve` node
 * (operation `metGetProductById`).
 *
 * Deliberately tolerant (STACK.md §7 requires zod-validated parsing of every
 * external response, AGENTS.md §6.1 keeps decoding in the service layer): every
 * field is optional and unknown keys pass through (Zod 4 `z.looseObject`, the
 * non-deprecated replacement for `.passthrough()`), so a Sony shape change
 * degrades to empty description / genres rather than throwing and failing the
 * request. Only the fields the PDP enrichment reads are described.
 */
const sonyDescriptionSchema = z.looseObject({
  type: z.string().optional(),
  subType: z.string().nullish(),
  value: z.string().optional(),
})

const sonyLocalizedGenreSchema = z.looseObject({
  value: z.string().optional(),
})

export const productRetrieveSchema = z.looseObject({
  id: z.string().optional(),
  releaseDate: z.string().optional(),
  publisherName: z.string().optional(),
  descriptions: z.array(sonyDescriptionSchema).optional(),
  combinedLocalizedGenres: z.array(sonyLocalizedGenreSchema).optional(),
})

export type ProductRetrieveNode = z.infer<typeof productRetrieveSchema>

/**
 * Parse the `productRetrieve` node defensively. Returns the validated node, or
 * `null` when the payload is missing or malformed — callers degrade to empty
 * values rather than surfacing a transport-level failure to the user.
 */
export const parseProductRetrieve = (node: unknown): ProductRetrieveNode | null => {
  if (node === null || node === undefined) {
    return null
  }

  const result = productRetrieveSchema.safeParse(node)
  return result.success ? result.data : null
}
