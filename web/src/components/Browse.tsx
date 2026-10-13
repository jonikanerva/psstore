import {
  BROWSE_ORDER_LABELS,
  BROWSE_ORDERS,
  filterGamesByName,
  isBrowseOrder,
  type BrowseOrder,
  type Game,
  type Genre,
} from '@psstore/shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { BROWSE_PATH, type BrowseParams } from '../modules/browseParams'
import { browseQueryOptions, genresQueryOptions } from '../modules/browseQuery'
import { useSearchQuery } from '../modules/searchContext'
import { normalizeSearchTerm } from '../modules/searchTerm'
import Error from './Error'
import GameGrid from './GameGrid'
import Offline from './Offline'
import SearchAllCard from './SearchAllCard'
import Spinner from './Spinner'

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

interface BrowseFormProps {
  genres: readonly Genre[]
  genre: string
  order: string
}

// Two required selects and a Browse button. A change of a select fetches
// nothing; only Browse writes the selection to the URL. The browser's own
// `required` check names an empty select and keeps the button enabled.
const BrowseForm = ({ genres, genre, order }: BrowseFormProps) => {
  const navigate = useNavigate()
  const genreId = useId()
  const orderId = useId()
  const [genreDraft, setGenreDraft] = useState(genre)
  const [orderDraft, setOrderDraft] = useState(order)

  return (
    <form
      className="browse-form"
      aria-label="Browse PS5 games"
      onSubmit={(event) => {
        event.preventDefault()
        if (
          !genres.some((item) => item.key === genreDraft) ||
          !isBrowseOrder(orderDraft)
        ) {
          return
        }
        void navigate({
          to: BROWSE_PATH,
          search: { genre: genreDraft, order: orderDraft },
        })
      }}
    >
      <div className="browse-form--field">
        <label htmlFor={genreId} className="browse-form--label">
          Genre
        </label>
        <select
          id={genreId}
          className="browse-form--select"
          required
          value={genreDraft}
          onChange={(event) => {
            setGenreDraft(event.currentTarget.value)
          }}
        >
          <option value="">Select genre</option>
          {genres.map((item) => (
            <option key={item.key} value={item.key}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="browse-form--field">
        <label htmlFor={orderId} className="browse-form--label">
          Order
        </label>
        <select
          id={orderId}
          className="browse-form--select"
          required
          value={orderDraft}
          onChange={(event) => {
            setOrderDraft(event.currentTarget.value)
          }}
        >
          <option value="">Select order</option>
          {BROWSE_ORDERS.map((item) => (
            <option key={item} value={item}>
              {BROWSE_ORDER_LABELS[item]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="browse-form--button">
        Browse
      </button>
    </form>
  )
}

interface BrowseResultsProps {
  genre: Genre
  order: BrowseOrder
}

const BrowseResults = ({ genre, order }: BrowseResultsProps) => {
  const query = useSearchQuery()
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
  } = useInfiniteQuery(browseQueryOptions(genre.key, order))

  const unique =
    data === undefined
      ? []
      : uniqueById(data.pages.flatMap((page) => page.games))
  const awaitingMore = data !== undefined && hasNextPage && unique.length === 0

  // A page whose games the scope check removed still has a next page to read.
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

  const term = normalizeSearchTerm(query)
  const games = filterGamesByName(unique, query)
  const offline = isPending && fetchStatus === 'paused'
  const failed = isError && data === undefined
  const empty = data !== undefined && unique.length === 0 && !hasNextPage
  const showGrid = unique.length > 0
  const loadingMore = awaitingMore && !isFetchNextPageError

  return (
    <>
      <h1 className="search-results--heading">
        {genre.name} · {BROWSE_ORDER_LABELS[order]}
      </h1>
      <div role="status" className="search-results--status">
        {failed ? (
          <Error message="Failed to load games" />
        ) : empty ? (
          <Error message={`No PS5 games found in ${genre.name}`} />
        ) : null}
      </div>
      {failed && retry(refetch)}
      {offline && <Offline />}
      {isPending && !offline && <Spinner />}
      {loadingMore && (fetchStatus === 'paused' ? <Offline /> : <Spinner />)}
      {showGrid && (
        <GameGrid
          games={games}
          label="browse"
          showPreOrder
          trailing={term === '' ? null : <SearchAllCard term={term} />}
          // The name filter covers the loaded pages only. A genre can have
          // thousands of games, so a filter that leaves few cards must not
          // load page after page.
          hasNextPage={term === '' && hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      )}
      {isFetchNextPageError && (
        <>
          <Error message="Could not load more games" />
          {retry(fetchNextPage)}
        </>
      )}
    </>
  )
}

interface BrowseProps {
  params: BrowseParams
}

// BROWSE: one Sony genre in one Sony order. The URL holds the whole selection;
// nothing is stored. A genre that Sony's list does not name, or an unknown
// order, leaves its select empty and fetches no games.
const Browse = ({ params }: BrowseProps) => {
  const genresQuery = useQuery(genresQueryOptions)

  if (genresQuery.isPending) {
    return (
      <div className="search-results">
        {genresQuery.fetchStatus === 'paused' ? <Offline /> : <Spinner />}
      </div>
    )
  }

  if (genresQuery.isError) {
    return (
      <div className="search-results">
        <div role="status" className="search-results--status">
          <Error message="Failed to load genres" />
        </div>
        <button
          type="button"
          className="search-results--retry"
          onClick={() => {
            void genresQuery.refetch()
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const { genres } = genresQuery.data
  const genre = genres.find((item) => item.key === params.genre)
  const order = params.order

  return (
    <div className="search-results">
      {/* A new URL selection re-seeds the form drafts. */}
      <BrowseForm
        key={`form|${genre?.key ?? ''}|${order ?? ''}`}
        genres={genres}
        genre={genre?.key ?? ''}
        order={order ?? ''}
      />
      {genre !== undefined && order !== undefined && (
        <BrowseResults
          key={`results|${genre.key}|${order}`}
          genre={genre}
          order={order}
        />
      )}
    </div>
  )
}

export default Browse
