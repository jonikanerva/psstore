import type { GameSort, SortField } from '@psstore/shared'

export const SORT_FIELD_LABELS = {
  date: 'Date',
  price: 'Price',
  name: 'Name',
} as const satisfies Record<SortField, string>

export interface SortConfig {
  readonly fields: readonly SortField[]
  readonly defaultSort: GameSort
  // True when the server order is exactly `defaultSort`: the view then shows
  // that order as it is, without loading every page or re-sorting. False means
  // the view always sorts on the client, at the default too.
  readonly serverOrdered: boolean
}

// Only a field that most entries of the view fill in is offered. MONTHLY has
// no price and PURCHASED has no date. An entry without a value for the sorted
// field, such as an UPCOMING concept without a price, sorts last.
// PURCHASED, WISHLIST and SEARCH arrive in an order that no offered field
// describes (Sony's own, or relevance), so they sort on the client by their
// default field from the start.
const CONFIG_BY_PATH: Readonly<Record<string, SortConfig>> = {
  '/new': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
    serverOrdered: true,
  },
  '/upcoming': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'asc' },
    serverOrdered: true,
  },
  '/discounted': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
    serverOrdered: true,
  },
  '/monthly': {
    fields: ['date', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
    serverOrdered: true,
  },
  '/purchased': {
    fields: ['name'],
    defaultSort: { field: 'name', direction: 'asc' },
    serverOrdered: false,
  },
  '/wishlist': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'price', direction: 'asc' },
    serverOrdered: false,
  },
  '/search': {
    fields: ['date', 'price', 'name'],
    defaultSort: { field: 'date', direction: 'desc' },
    serverOrdered: false,
  },
}

export const sortConfigForPath = (pathname: string): SortConfig | undefined =>
  CONFIG_BY_PATH[pathname]

export const isSameSort = (a: GameSort, b: GameSort): boolean =>
  a.field === b.field && a.direction === b.direction
