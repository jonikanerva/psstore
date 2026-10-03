import { filterGamesByName } from '@psstore/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchQuery } from '../modules/searchContext'
import {
  PURCHASED_QUERY_KEY,
  purchasedQueryOptions,
} from '../modules/purchasedQuery'
import { HttpError, signOut } from '../modules/psnStore'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import SignIn from './SignIn'
import Loading from './Spinner'

const Purchased = () => {
  const search = useSearchQuery()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(
    purchasedQueryOptions,
  )
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: PURCHASED_QUERY_KEY })
    },
  })

  if (isPending) {
    return <Loading loading />
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

  return (
    <div className="games--content">
      <div className="purchased--bar">
        <button
          type="button"
          className="purchased--button"
          disabled={signOutMutation.isPending}
          onClick={() => {
            signOutMutation.mutate()
          }}
        >
          Sign out
        </button>
        {signOutMutation.isError && (
          <span role="alert">Sign-out failed. Try again.</span>
        )}
      </div>
      {data.games.length === 0 ? (
        <Error message="No PS5 games in your library" />
      ) : filtered.length === 0 ? (
        <Error message="No games found" />
      ) : (
        <>
          <ScrollToTopOnMount />
          <div className="games--grid" data-label="purchased">
            {filtered.map((game) => (
              <GameCard key={game.id} game={game} showPrice={false} outbound />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default Purchased
