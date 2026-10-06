import { Schema } from 'effect'

// The BROWSE view lists the PS5 games of one Sony genre in one Sony order.
// These keys are our own URL and API values. The server maps each key to
// Sony's sort; Sony's internal sort names never reach the URL.
export const BROWSE_ORDERS = [
  'best-selling',
  'most-downloaded',
  'newest',
  'oldest',
  'name-asc',
  'name-desc',
] as const

export type BrowseOrder = (typeof BROWSE_ORDERS)[number]

export const browseOrderSchema = Schema.Literals(BROWSE_ORDERS)

export const BROWSE_ORDER_LABELS = {
  'best-selling': 'Best selling',
  'most-downloaded': 'Most downloaded',
  newest: 'Release date (newest first)',
  oldest: 'Release date (oldest first)',
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
} as const satisfies Record<BrowseOrder, string>

export const isBrowseOrder = (value: unknown): value is BrowseOrder =>
  typeof value === 'string' && BROWSE_ORDERS.some((order) => order === value)

// Sony's genre facet keys are upper case with `_` and `/`, for example
// `ROLE_PLAYING_GAMES` and `MUSIC/RHYTHM`. The server drops a genre whose key
// does not match, so the client never offers a key that the API rejects.
export const GENRE_KEY_PATTERN = /^[A-Z0-9_/-]{1,64}$/

export const isGenreKey = (value: string): boolean =>
  GENRE_KEY_PATTERN.test(value)

// One Sony genre: its facet key and its display name. Sony's product count is
// left out on purpose: the scope filter drops some entries, so the count does
// not match the list.
export const genreSchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
})

export const genreListSchema = Schema.Struct({
  genres: Schema.Array(genreSchema),
})
