import { Result, Schema } from 'effect'
import {
  categoryGridProductSchema,
  conceptSchema,
  type CategoryGridProduct,
  type Concept,
} from './categoryGridSchema.js'

/**
 * Boundary schema for Sony's `data.universalSearch` node (operation
 * `getSearchResults`). Tolerant like `categoryGridSchema.ts`: every field is
 * optional and nullable, unknown keys are ignored, and each result element is
 * decoded on its own so one odd element never empties the page. Sony applies
 * no platform filter to search, so the decoded entries are NOT yet in product
 * scope: `narrowSearchEntries` in `domain/listing.ts` enforces it.
 */
const typenameSchema = Schema.Struct({
  __typename: Schema.optional(Schema.NullOr(Schema.String)),
})

const pageInfoSchema = Schema.Struct({
  isLast: Schema.optional(Schema.NullOr(Schema.Boolean)),
})

const searchNodeSchema = Schema.Struct({
  pageInfo: Schema.optional(Schema.NullOr(pageInfoSchema)),
  results: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
})

const envelopeSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        universalSearch: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
})

export type SearchEntry =
  | { readonly kind: 'product'; readonly product: CategoryGridProduct }
  | { readonly kind: 'concept'; readonly concept: Concept }

export type SearchOutcome =
  | { readonly kind: 'drift' }
  | {
      readonly kind: 'ok'
      readonly entries: readonly SearchEntry[]
      readonly isLast: boolean
      readonly dropped: number
    }

const decodeEnvelope = Schema.decodeUnknownResult(envelopeSchema)
const decodeNode = Schema.decodeUnknownResult(searchNodeSchema)
const decodeTypename = Schema.decodeUnknownResult(typenameSchema)
const decodeProduct = Schema.decodeUnknownResult(categoryGridProductSchema)
const decodeConcept = Schema.decodeUnknownResult(conceptSchema)

const decodeEntry = (element: unknown): SearchEntry | null => {
  const typename = decodeTypename(element)
  if (Result.isFailure(typename)) {
    return null
  }

  switch (typename.success.__typename) {
    case 'Product': {
      const product = decodeProduct(element)
      return Result.isSuccess(product)
        ? { kind: 'product', product: product.success }
        : null
    }
    case 'Concept': {
      const concept = decodeConcept(element)
      return Result.isSuccess(concept)
        ? { kind: 'concept', concept: concept.success }
        : null
    }
    default:
      return null
  }
}

/**
 * Decode a whole search response. `drift` means the node, its `results`
 * array, or `pageInfo.isLast` is absent or unintelligible: the page cannot be
 * paged honestly, so the caller fails rather than reporting "no results".
 */
export const parseSearchResponse = (json: unknown): SearchOutcome => {
  const envelope = decodeEnvelope(json)
  if (Result.isFailure(envelope)) {
    return { kind: 'drift' }
  }

  const node = decodeNode(envelope.success.data?.universalSearch)
  if (Result.isFailure(node)) {
    return { kind: 'drift' }
  }

  const results = node.success.results
  const isLast = node.success.pageInfo?.isLast
  if (
    results === undefined ||
    results === null ||
    typeof isLast !== 'boolean'
  ) {
    return { kind: 'drift' }
  }

  const entries: SearchEntry[] = []
  let dropped = 0
  for (const element of results) {
    const entry = decodeEntry(element)
    if (entry === null) {
      dropped += 1
    } else {
      entries.push(entry)
    }
  }

  return { kind: 'ok', entries, isLast, dropped }
}
