import { filterGamesByName } from '@psstore/shared'
import { useQuery } from '@tanstack/react-query'
import { useSearchQuery } from '../modules/searchContext'
import { purchasedQueryOptions } from '../modules/purchasedQuery'
import { HttpError } from '../modules/psnStore'
import Error from './Error'
import GameGrid from './GameGrid'
import Offline from './Offline'
import SignIn from './SignIn'
import Spinner from './Spinner'

const Purchased = () => {
  const search = useSearchQuery()
  const { data, isPending, isError, error, fetchStatus, refetch } = useQuery(
    purchasedQueryOptions,
  )
  if (isPending) {
    return fetchStatus === 'paused' ? <Offline /> : <Spinner />
  }

  if (isError) {
    if (error instanceof HttpError && error.status === 401) {
      return <SignIn />
    }
    return (
      <div className="purchased--failure">
        <Error message="Failed to load your library" />
        <button
          type="button"
          className="purchased--button"
          onClick={() => {
            void refetch()
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const filtered = filterGamesByName(data.games, search)

  if (data.games.length === 0) {
    return <Error message="No PS5 games in your library" />
  }

  if (filtered.length === 0) {
    return <Error message="No games found" />
  }

  return (
    <GameGrid
      games={filtered}
      label="purchased"
      showPrice={false}
      outbound
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={() => undefined}
    />
  )
}

export default Purchased
