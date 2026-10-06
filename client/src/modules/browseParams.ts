import { isBrowseOrder, isGenreKey, type BrowseOrder } from '@psstore/shared'
import { Result, Schema } from 'effect'

export const BROWSE_PATH = '/browse'

// The BROWSE selection in the URL. `/browse` alone is the empty form. A value
// of the wrong shape reads as `undefined`. Both keys are always present: the
// router keeps a raw search value for a key that validation leaves out.
export interface BrowseParams {
  readonly genre: string | undefined
  readonly order: BrowseOrder | undefined
}

const browseSearchSchema = Schema.Struct({
  genre: Schema.optional(Schema.Unknown),
  order: Schema.optional(Schema.Unknown),
})

const decodeBrowseSearch = Schema.decodeUnknownResult(browseSearchSchema)

// Reads `genre` and `order` from an untrusted location search record. The
// genre key is checked by format here; the view also checks it against Sony's
// genre list before it fetches.
export const readBrowseParams = (search: unknown): BrowseParams => {
  const result = decodeBrowseSearch(search)
  if (Result.isFailure(result)) {
    return { genre: undefined, order: undefined }
  }
  const { genre, order } = result.success
  return {
    genre: typeof genre === 'string' && isGenreKey(genre) ? genre : undefined,
    order: isBrowseOrder(order) ? order : undefined,
  }
}
