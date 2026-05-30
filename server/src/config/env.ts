import { Duration } from 'effect'

// Fixed Sony-contract configuration. These values are part of the contract with
// Sony's public GraphQL endpoint, not deployment knobs — they were never meant
// to vary by environment (see issue #72). They are therefore plain code
// constants, not env-driven `Config` values. The only genuinely
// environment-driven setting (`PORT`) is read directly from `process.env` at
// the HTTP composition root (server.ts). The persisted-query hashes are rotated
// by the contract bot via `pnpm sony:refresh`, which edits this same file.

export const SONY_GRAPHQL_URL =
  'https://web.np.playstation.com/api/graphql/v1/op'
export const SONY_CATEGORY_GRID_HASH =
  '257713466fc3264850aa473409a29088e3a4115e6e69e9fb3e061c8dd5b9f5c6'
export const SONY_CATEGORY_ID = 'd0446d4b-dc9a-4f1e-86ec-651f099c9b29'
export const SONY_DEALS_CATEGORY_ID = '3f772501-f6f8-49b7-abac-874a88ca4897'
export const SONY_OPERATION_NAME = 'categoryGridRetrieve'
export const SONY_PRODUCT_OPERATION_NAME = 'metGetProductById'
export const SONY_PRODUCT_BY_ID_HASH =
  'a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a'
export const SONY_LOCALE = 'fi-fi'
export const SONY_RETRY_COUNT = 1
export const SONY_TIMEOUT_MS = 6000

// List cache TTL, pinned at 30000 ms exactly. Intentionally asymmetric with the
// per-product DETAIL_TTL (Duration.hours(6)) in gamesService: list windows
// refresh far more often than individual product metadata.
export const CACHE_TTL = Duration.millis(30000)
