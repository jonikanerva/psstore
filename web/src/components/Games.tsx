import { sortGames } from '../modules/sortGames'
import { filterGamesByName } from '../modules/filterGames'
import { useInfiniteQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import {
  gamesQueryOptions,
  type FetchGamesPage,
  type GamesFeature,
} from '../modules/gamesQuery'
import { useSearchQuery } from '../modules/searchContext'
import { useSort } from '../modules/sortContext'
import Error from './Error'
import { nextLocalDayStart, splitByReleaseDay } from '../modules/releaseDay'
import { normalizeSearchTerm } from '../modules/searchTerm'
import GameGrid from './GameGrid'
import Offline from './Offline'
import RefreshNote from './RefreshNote'
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
    isRefetchError,
    fetchStatus,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(gamesQueryOptions(feature, fetch))

  // A failed refresh of a list that the cache already holds keeps the list
  // (#164). Any other failure shows the error state: the first load, a next
  // page, or a page that a sort still needs.
  if (isError && (!isRefetchError || (sort !== null && hasNextPage))) {
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

  const games = splitByReleaseDay(
    feature,
    data.pages.flatMap((page) => page.games),
    nextLocalDayStart(DateTime.now()),
  )
  const filtered = filterGamesByName(games, query)
  const ordered = sort === null ? filtered : sortGames(filtered, sort)

  const term = normalizeSearchTerm(query)

  // The status region is on the page with the list, so a screen reader
  // announces a later failed refresh.
  return (
    <>
      <div role="status" className="games--status">
        <RefreshNote failed={isRefetchError} />
      </div>
      {/* The release-day split can empty a loaded page; the grid then loads
          the next one. */}
      {filtered.length === 0 && term === '' && !hasNextPage ? (
        <Error message={emptyMessage} />
      ) : (
        <GameGrid
          games={ordered}
          label={feature}
          showPrice={feature !== 'monthly'}
          trailing={term === '' ? null : <SearchAllCard term={term} />}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      )}
    </>
  )
}

export default Games
