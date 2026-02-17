import { env } from '../config/env.js'

export type SonyFeature = 'new' | 'upcoming' | 'discounted' | 'plus' | 'search'

export interface StrategyContext {
  size?: number
  offset?: number
  query?: string
}

export interface SonyQueryStrategy {
  feature: SonyFeature
  operationName: string
  persistedQueryHash: string
  fallbackKey: 'base' | 'upcoming' | 'discounted' | 'plus' | 'search'
  buildVariables: (context: StrategyContext) => Record<string, unknown>
}

const baseVariables = (context: StrategyContext): Record<string, unknown> => ({
  id: env.SONY_CATEGORY_ID,
  locale: env.SONY_LOCALE,
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
  operationName: env.SONY_OPERATION_NAME,
  persistedQueryHash: env.SONY_CATEGORY_GRID_HASH,
  fallbackKey,
  buildVariables,
})

export const sonyStrategies: Record<SonyFeature, SonyQueryStrategy> = {
  new: strategy('new', 'base', (context) => baseVariables(context)),
  upcoming: strategy('upcoming', 'upcoming', (context) => ({
    ...baseVariables(context),
    filterBy: ['targetPlatforms:PS5', 'conceptReleaseDate:next_thirty_days'],
  })),
  discounted: strategy('discounted', 'discounted', (context) => ({
    ...baseVariables(context),
    id: env.SONY_DEALS_CATEGORY_ID,
    filterBy: ['targetPlatforms:PS5'],
  })),
  plus: strategy('plus', 'plus', (context) => ({
    ...baseVariables(context),
    filterBy: ['targetPlatforms:PS5', 'subscriptionService:PS_PLUS'],
  })),
  search: strategy('search', 'search', (context) => ({
    ...baseVariables(context),
    query: context.query ?? '',
    searchTerm: context.query ?? '',
  })),
}
