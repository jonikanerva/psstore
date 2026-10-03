import type { SortField } from '@psstore/shared'

export const SORT_FIELD_LABELS = {
  date: 'Date',
  price: 'Price',
  name: 'Name',
} as const satisfies Record<SortField, string>

// Only a field that most entries of the view fill in is offered. UPCOMING
// concept entries have no price, MONTHLY has none, and PURCHASED has no date.
const FIELDS_BY_PATH: Readonly<Record<string, readonly SortField[]>> = {
  '/new': ['date', 'price', 'name'],
  '/discounted': ['date', 'price', 'name'],
  '/upcoming': ['date', 'name'],
  '/monthly': ['date', 'name'],
  '/purchased': ['name'],
}

export const sortFieldsForPath = (pathname: string): readonly SortField[] =>
  FIELDS_BY_PATH[pathname] ?? []
