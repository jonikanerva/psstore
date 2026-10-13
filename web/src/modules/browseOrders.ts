import type { BrowseOrder } from '@psstore/api-client'

// The label of each BROWSE order in the order select. The API contract owns
// the order keys (`BROWSE_ORDERS` of the API client); `satisfies` makes this
// table list every key.
export const BROWSE_ORDER_LABELS = {
  'best-selling': 'Best selling',
  'most-downloaded': 'Most downloaded',
  newest: 'Release date (newest first)',
  oldest: 'Release date (oldest first)',
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
} as const satisfies Record<BrowseOrder, string>
