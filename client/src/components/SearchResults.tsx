import { sortGames, type Game } from '@psstore/shared'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchSearchGames } from '../modules/psnStore'
import { useSort } from '../modules/sortContext'
import Error from './Error'
import GameGrid from './GameGrid'
import Offline from './Offline'
import Spinner from './Spinner'

const PAGE_SIZE = 50
const SEARCH_GC_TIME_MS = 60_000

interface SearchResultsProps {
  term: string
}

const uniqueById = (games: readonly Game[]): Game[] => {
  const seen = new Set<string>()
  return games.filter((game) => {
    if (seen.has(game.id)) {
      return false
    }
    seen.add(game.id)
    return true
  })
}

const countLabel = (count: number): string =>
  `${String(count)} PS5 ${count === 1 ? 'game' : 'games'} found`

// Results of the global search. The term in the URL is the only source of
// truth. The query key stays outside the persister allow-list, so a term never
// reaches localStorage. The grid is held until every page is loaded, so the
// sorted order is complete before any card shows. The live region stays mounted so that a screen reader
// announces each outcome; focus never moves.
const SearchResults = ({ term }: SearchResultsProps) => {
  const sort = useSort()
  const {
    data,
    isPending,
    isError,
    isFetchNextPageError,
    fetchStatus,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['search', term],
    queryFn: ({ pageParam, signal }) =>
      fetchSearchGames(term, pageParam, PAGE_SIZE, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    gcTime: SEARCH_GC_TIME_MS,
  })

  const unique =
    data === undefined
      ? []
      : uniqueById(data.pages.flatMap((page) => page.games))
  const games = sort === null ? unique : sortGames(unique, sort)
  const awaitingMore =
    data !== undefined && hasNextPage && (unique.length === 0 || sort !== null)

  // A page whose games were all filtered out still has a next page to read. A
  // sorted view reads every page before it shows a card.
  useEffect(() => {
    if (awaitingMore && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [awaitingMore, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const retry = (action: () => unknown) => (
    <button
      type="button"
      className="search-results--retry"
      onClick={() => {
        void action()
      }}
    >
      Retry
    </button>
  )

  const offline = isPending && fetchStatus === 'paused'
  const failed = isError && data === undefined
  const empty = data !== undefined && games.length === 0 && !hasNextPage
  const showResults = games.length > 0 && !awaitingMore
  const loadingMore = awaitingMore && !isFetchNextPageError
  const pagingOffline = loadingMore && fetchStatus === 'paused'

  const status = failed ? (
    <Error message="Search failed" />
  ) : empty ? (
    <Error message={`No PS5 games found for "${term}"`} />
  ) : showResults ? (
    countLabel(games.length)
  ) : null

  return (
    <div className="search-results">
      {showResults && (
        <h1 className="search-results--heading">
          Results for &quot;{term}&quot;
        </h1>
      )}
      <div role="status" className="search-results--status">
        {status}
      </div>
      {failed && retry(refetch)}
      {offline && <Offline />}
      {isPending && !offline && <Spinner />}
      {loadingMore && (pagingOffline ? <Offline /> : <Spinner />)}
      {showResults && (
        <GameGrid
          games={games}
          label="search"
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      )}
      {isFetchNextPageError && (
        <>
          <Error message="Could not load more results" />
          {retry(fetchNextPage)}
        </>
      )}
    </div>
  )
}

export default SearchResults
