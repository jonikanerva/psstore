import type { GameSort, SortField } from '@psstore/shared'

export const SORT_FIELD_LABELS = {
  date: 'Date',
  price: 'Price',
  name: 'Name',
} as const satisfies Record<SortField, string>

export interface SortConfig {
  readonly fields: readonly SortField[]
  // The sort that describes the order the server returns. A view at its
  // default sort is neither loaded in full nor re-sorted.
  readonly defaultSort: GameSort
}

// Only a field that most entries of the view fill in is offered. UPCOMING
// concept entries have no price, MONTHLY has none, and PURCHASED has no date.
// PURCHASED arrives in Sony's activation-date order, which no offered field
// describes, so Name stands in as its default label.
const CONFIG_BY_PATH: Readonly<Record<string, SortConfig>> = {
  '/new': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
  },
  '/upcoming': {
    fields: ['date', 'name'],
    defaultSort: { field: 'date', direction: 'asc' },
  },
  '/discounted': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
  },
  '/monthly': {
    fields: ['date', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
  },
  '/purchased': {
    fields: ['name'],
    defaultSort: { field: 'name', direction: 'asc' },
  },
  '/wishlist': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
  },
}

export const sortConfigForPath = (pathname: string): SortConfig | undefined =>
  CONFIG_BY_PATH[pathname]

export const isSameSort = (a: GameSort, b: GameSort): boolean =>
  a.field === b.field && a.direction === b.direction
