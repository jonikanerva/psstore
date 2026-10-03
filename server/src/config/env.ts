import { Duration } from 'effect'

// Fixed Sony-contract configuration. These values are part of the contract with
// Sony's public GraphQL endpoint, not deployment knobs. They must not vary by
// environment: keep them as plain code constants, not env-driven `Config`
// values. The only environment-driven setting (`PORT`) is read directly from
// `process.env` at the HTTP composition root (server.ts). The contract bot
// edits the persisted-query hashes in this file during `pnpm sony:refresh`.

export const SONY_GRAPHQL_URL =
  'https://web.np.playstation.com/api/graphql/v1/op'
export const SONY_CATEGORY_GRID_HASH =
  '88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03'
export const SONY_CATEGORY_ID = 'd0446d4b-dc9a-4f1e-86ec-651f099c9b29'
export const SONY_DEALS_CATEGORY_ID = '3f772501-f6f8-49b7-abac-874a88ca4897'
export const SONY_OPERATION_NAME = 'categoryGridRetrieve'
export const SONY_PRODUCT_OPERATION_NAME = 'metGetProductById'
export const SONY_PRODUCT_BY_ID_HASH =
  'a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a'
export const SONY_PRODUCT_PRICE_OPERATION_NAME =
  'productRetrieveForCtasWithPrice'
export const SONY_PRODUCT_PRICE_HASH =
  '1f0ca607e170abbfb7d67bd76c9bbc97f21fe2e807be49e5fe764e14566cb605'
export const SONY_SEARCH_OPERATION_NAME = 'getSearchResults'
export const SONY_SEARCH_HASH =
  '4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa'
// Sony rejects a search page larger than this with a validation error.
export const SONY_SEARCH_MAX_PAGE_SIZE = 50
// The PS Plus monthly games list is a separate anonymous JSON feed outside the
// GraphQL contract; the content language is SONY_LOCALE.
export const SONY_PLUS_MONTHLY_URL =
  'https://www.playstation.com/bin/imagic/gameslist'
export const SONY_PLUS_MONTHLY_CATEGORY = 'plus-monthly-games-list'
// Content language and store region in one tag: English content from the
// Finnish store (EUR). Fixed constant: never derived from the visitor.
export const SONY_LOCALE = 'en-fi'
export const SONY_RETRY_COUNT = 1
export const SONY_TIMEOUT_MS = 6000

// Upper bound on how long a 429 `Retry-After` may pause the request hot path
// before the single retry. Derived from (and equal to) the per-attempt timeout
// so the honoured delay can never exceed the request's existing budget: an
// upstream sending a multi-minute `Retry-After` must not stall an interactive
// request (CLAUDE.md → Responsiveness). Seconds, never minutes — a larger
// upstream value is clamped to this ceiling.
export const SONY_RETRY_AFTER_MAX_MS = SONY_TIMEOUT_MS

// List cache TTL, pinned at 30000 ms exactly. Intentionally asymmetric with the
// per-product DETAIL_TTL (Duration.hours(6)) in gamesService: list windows
// refresh far more often than individual product metadata.
export const CACHE_TTL = Duration.millis(30000)
