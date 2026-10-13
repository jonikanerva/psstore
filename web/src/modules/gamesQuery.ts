import {
  infiniteQueryOptions,
  InfiniteQueryObserver,
  type QueryClient,
} from '@tanstack/react-query'
import type { PageResult } from '@psstore/shared'
import {
  fetchDiscountedGames,
  fetchMonthlyGames,
  fetchNewGames,
  fetchUpcomingGames,
} from './psnStore'

export const PAGE_SIZE = 60

export type GamesFeature = 'new' | 'upcoming' | 'discounted' | 'monthly'
export type FetchGamesPage = (
  offset: number,
  size: number,
) => Promise<PageResult>

const FEATURE_BY_PATH: Readonly<
  Record<string, { feature: GamesFeature; fetch: FetchGamesPage }>
> = {
  '/new': { feature: 'new', fetch: fetchNewGames },
  '/upcoming': { feature: 'upcoming', fetch: fetchUpcomingGames },
  '/discounted': { feature: 'discounted', fetch: fetchDiscountedGames },
  '/monthly': { feature: 'monthly', fetch: fetchMonthlyGames },
}

export const gamesFeatureForPath = (pathname: string) =>
  FEATURE_BY_PATH[pathname]

// Query key is the feature only (pagination flows through pageParam); the
// search text and the sort are never part of it. Each page's `nextOffset`
// becomes the next pageParam, or undefined to stop.
export const gamesQueryOptions = (
  feature: GamesFeature,
  fetch: FetchGamesPage,
) =>
  infiniteQueryOptions({
    queryKey: ['games', feature],
    queryFn: ({ pageParam }) => fetch(pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage: PageResult) =>
      lastPage.nextOffset ?? undefined,
  })

// Fetches every remaining page of the shared games query, one at a time. It
// joins a fetch already in flight instead of cancelling it, and stops between
// pages when `signal` aborts. A failed page leaves the query in its error
// state, which the view shows; the promise never rejects.
export const loadAllPages = async (
  queryClient: QueryClient,
  options: ReturnType<typeof gamesQueryOptions>,
  signal: AbortSignal,
): Promise<void> => {
  const observer = new InfiniteQueryObserver(queryClient, options)
  let result = observer.getCurrentResult()
  while (!signal.aborted && (result.data === undefined || result.hasNextPage)) {
    result = await observer.fetchNextPage({ cancelRefetch: false })
    if (result.isError) {
      return
    }
  }
}
