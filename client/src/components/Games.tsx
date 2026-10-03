import { filterGamesByName, sortGames } from '@psstore/shared'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  gamesQueryOptions,
  type FetchGamesPage,
  type GamesFeature,
} from '../modules/gamesQuery'
import { useSearchQuery } from '../modules/searchContext'
import { useSort } from '../modules/sortContext'
import Error from './Error'
import { normalizeSearchTerm } from '../modules/searchTerm'
import GameGrid from './GameGrid'
import Offline from './Offline'
import SearchAllCard from './SearchAllCard'
import Spinner from './Spinner'

interface GamesProps {
  feature: GamesFeature
  fetch: FetchGamesPage
  emptyMessage?: string
}

const Games = ({
  feature,
  fetch,
  emptyMessage = 'No games found',
}: GamesProps) => {
  const query = useSearchQuery()
  const sort = useSort()

  const {
    data,
    isPending,
    isError,
    fetchStatus,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(gamesQueryOptions(feature, fetch))

  if (isError) {
    return <Error message="Failed to load games" />
  }

  if (isPending) {
    return fetchStatus === 'paused' ? <Offline /> : <Spinner />
  }

  // A sort covers every page: until the last one arrives the list stays
  // hidden rather than half sorted.
  if (sort !== null && hasNextPage) {
    return fetchStatus === 'paused' ? <Offline /> : <Spinner />
  }

  const games = data.pages.flatMap((page) => page.games)
  const filtered = filterGamesByName(games, query)
  const ordered = sort === null ? filtered : sortGames(filtered, sort)

  const term = normalizeSearchTerm(query)

  if (filtered.length === 0 && term === '') {
    return <Error message={emptyMessage} />
  }

  return (
    <GameGrid
      games={ordered}
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
