import { browseOrderSchema, GENRE_KEY_PATTERN } from '@psstore/shared'
import { Effect, Schema } from 'effect'
import { SONY_SEARCH_MAX_PAGE_SIZE } from '../config/env.js'

// Path / query parameter schemas for the HttpApi endpoints (api/gamesApi.ts).
// URL params arrive as strings, so numeric fields decode from string
// (`NumberFromString`): offset ≥ 0 default 0; size in [1, 120] default 60.

export const gameIdParamSchema = Schema.Struct({
  id: Schema.Trim.check(Schema.isMinLength(1)),
})

const offsetFromString = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)

const sizeFromString = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(120),
)

export const paginationQuerySchema = Schema.Struct({
  offset: offsetFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(0)),
  ),
  size: sizeFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(60)),
  ),
})

// The search term is trimmed before its length is checked. The size cap is
// Sony's page-size limit for search.
export const searchQuerySchema = Schema.Struct({
  q: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  offset: offsetFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(0)),
  ),
  size: sizeFromString
    .check(Schema.isLessThanOrEqualTo(SONY_SEARCH_MAX_PAGE_SIZE))
    .pipe(
      Schema.optional,
      Schema.withDecodingDefaultType(Effect.succeed(SONY_SEARCH_MAX_PAGE_SIZE)),
    ),
})

// BROWSE: one Sony genre key and one of our order keys. The genre is checked by
// format only. Sony answers an unknown key with an empty grid, and the client
// sends only keys from the genre list.
export const browseQuerySchema = Schema.Struct({
  genre: Schema.String.check(Schema.isPattern(GENRE_KEY_PATTERN)),
  order: browseOrderSchema,
  offset: offsetFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(0)),
  ),
  size: sizeFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(60)),
  ),
})
