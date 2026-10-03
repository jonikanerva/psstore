import type { PageResult } from '@psstore/shared'
import { filterGamesByName } from '@psstore/shared'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useSearchQuery } from '../modules/searchContext'
import Error from './Error'
import { normalizeSearchTerm } from '../modules/searchTerm'
import GameGrid from './GameGrid'
import Offline from './Offline'
import SearchAllCard from './SearchAllCard'
import Spinner from './Spinner'

const PAGE_SIZE = 60

interface GamesProps {
  feature: 'new' | 'upcoming' | 'discounted' | 'monthly'
  fetch: (offset: number, size: number) => Promise<PageResult>
  emptyMessage?: string
}

const Games = ({
  feature,
  fetch,
  emptyMessage = 'No games found',
}: GamesProps) => {
  const query = useSearchQuery()

  // Query key is feature only (pagination flows through pageParam); the search
  // text is never part of the key, so the persisted cache carries no search or
  // behaviour state. useInfiniteQuery accumulates pages: each page's
  // `nextOffset` becomes the next pageParam, or undefined to stop.
  const {
    data,
    isPending,
    isError,
    fetchStatus,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['games', feature],
    queryFn: ({ pageParam }) => fetch(pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  })

  if (isError) {
    return <Error message="Failed to load games" />
  }

  if (isPending) {
    return fetchStatus === 'paused' ? <Offline /> : <Spinner />
  }

  const games = data.pages.flatMap((page) => page.games)
  const filtered = filterGamesByName(games, query)

  const term = normalizeSearchTerm(query)

  if (filtered.length === 0 && term === '') {
    return <Error message={emptyMessage} />
  }

  return (
    <GameGrid
      games={filtered}
      label={feature}
      showPrice={feature !== 'monthly'}
      trailing={term === '' ? null : <SearchAllCard term={term} />}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={fetchNextPage}
    />
  )
}

export default Games
