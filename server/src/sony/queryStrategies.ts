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
  // `conceptReleaseDate:last_thirty_days` ("Juuri julkaistut") bounds the grid to
  // the released PS5 window, so genuinely recent releases are no longer stranded
  // beyond a blind day-granular prefix (see the spike doc, section B). Keeps the
  // `conceptReleaseDate`-desc sort from baseVariables.
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
