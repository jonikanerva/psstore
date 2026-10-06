import type { BrowseOrder } from '@psstore/shared'
import {
  SONY_CATEGORY_GRID_HASH,
  SONY_CATEGORY_ID,
  SONY_DEALS_CATEGORY_ID,
  SONY_LOCALE,
  SONY_OPERATION_NAME,
} from '../config/env.js'

export type SonyFeature = 'new' | 'upcoming' | 'discounted'

export interface StrategyContext {
  size?: number
  offset?: number
}

// The operation name and persisted-query hash of one grid request.
export interface GridOperation {
  readonly operationName: string
  readonly persistedQueryHash: string
}

export interface SonyQueryStrategy {
  feature: SonyFeature
  operationName: string
  persistedQueryHash: string
  fallbackKey: 'base' | 'upcoming' | 'discounted'
  buildVariables: (context: StrategyContext) => Record<string, unknown>
}

const baseVariables = (context: StrategyContext): Record<string, unknown> => ({
  id: SONY_CATEGORY_ID,
  locale: SONY_LOCALE,
  pageArgs: { size: context.size ?? 300, offset: context.offset ?? 0 },
  sortBy: { name: 'conceptReleaseDate', isAscending: false },
  filterBy: ['targetPlatforms:PS5'],
  facetOptions: [],
})

const strategy = (
  feature: SonyFeature,
  fallbackKey: SonyQueryStrategy['fallbackKey'],
  buildVariables: SonyQueryStrategy['buildVariables'],
): SonyQueryStrategy => ({
  feature,
  operationName: SONY_OPERATION_NAME,
  persistedQueryHash: SONY_CATEGORY_GRID_HASH,
  fallbackKey,
  buildVariables,
})

export const buildStrategies = (): Record<SonyFeature, SonyQueryStrategy> => ({
  // NEW uses Sony's released-twin facet of UPCOMING's `next_thirty_days` token.
  // `conceptReleaseDate:last_thirty_days` bounds the grid to
  // the released PS5 window, so no recent release falls outside a day-granular
  // prefix. Keeps the `conceptReleaseDate`-desc sort from baseVariables.
  new: strategy('new', 'base', (context) => ({
    ...baseVariables(context),
    filterBy: ['targetPlatforms:PS5', 'conceptReleaseDate:last_thirty_days'],
  })),
  upcoming: strategy('upcoming', 'upcoming', (context) => ({
    ...baseVariables(context),
    filterBy: ['targetPlatforms:PS5', 'conceptReleaseDate:next_thirty_days'],
  })),
  discounted: strategy('discounted', 'discounted', (context) => ({
    ...baseVariables(context),
    id: SONY_DEALS_CATEGORY_ID,
    filterBy: ['targetPlatforms:PS5'],
  })),
})

// ---- BROWSE ----------------------------------------------------------------
//
// BROWSE reads the same "All PS5 games" grid with the same persisted query. It
// filters by one Sony genre facet and lets Sony sort, so each page arrives in
// its final order. Sony lists every sort below in the grid's
// `sortingOptions`, except the price sort, which BROWSE does not offer.

export const BROWSE_GRID_OPERATION: GridOperation = {
  operationName: SONY_OPERATION_NAME,
  persistedQueryHash: SONY_CATEGORY_GRID_HASH,
}

export interface SonySort {
  readonly name: string
  readonly isAscending: boolean
}

export const BROWSE_SONY_SORT = {
  'best-selling': { name: 'sales30', isAscending: false },
  'most-downloaded': { name: 'downloads30', isAscending: false },
  newest: { name: 'conceptReleaseDate', isAscending: false },
  oldest: { name: 'conceptReleaseDate', isAscending: true },
  'name-asc': { name: 'conceptName', isAscending: true },
  'name-desc': { name: 'conceptName', isAscending: false },
} as const satisfies Record<BrowseOrder, SonySort>

export interface BrowseRequest {
  readonly genre: string
  readonly order: BrowseOrder
  readonly offset: number
  readonly size: number
}

// Sony answers an unknown genre key with an empty grid (observed 2026-10-06),
// not with every game.
export const buildBrowseVariables = (
  request: BrowseRequest,
): Record<string, unknown> => ({
  id: SONY_CATEGORY_ID,
  locale: SONY_LOCALE,
  pageArgs: { size: request.size, offset: request.offset },
  sortBy: BROWSE_SONY_SORT[request.order],
  filterBy: ['targetPlatforms:PS5', `conceptGenres:${request.genre}`],
  facetOptions: [],
})

// The genre list: page size 0 returns the facets of the PS5 grid without any
// concept.
export const buildGenreListVariables = (): Record<string, unknown> => ({
  id: SONY_CATEGORY_ID,
  locale: SONY_LOCALE,
  pageArgs: { size: 0, offset: 0 },
  sortBy: null,
  filterBy: ['targetPlatforms:PS5'],
  facetOptions: [],
})
