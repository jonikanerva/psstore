import { filterGamesByName } from '@psstore/shared'
import { useQuery } from '@tanstack/react-query'
import type { signedInQueryOptions } from '../modules/signedInQuery'
import { useSearchQuery } from '../modules/searchContext'
import { normalizeSearchTerm } from '../modules/searchTerm'
import { HttpError } from '../modules/psnStore'
import Error from './Error'
import GameGrid from './GameGrid'
import Offline from './Offline'
import SearchAllCard from './SearchAllCard'
import SignIn from './SignIn'
import Spinner from './Spinner'

interface SignedInListProps {
  readonly query: ReturnType<typeof signedInQueryOptions>
  readonly label: string
  readonly failureMessage: string
  readonly emptyMessage: string
}

// A signed-in list view: the user's own Sony data, read-only, without prices.
const SignedInList = ({
  query,
  label,
  failureMessage,
  emptyMessage,
}: SignedInListProps) => {
  const search = useSearchQuery()
  const { data, isPending, isError, error, fetchStatus, refetch } =
    useQuery(query)
  if (isPending) {
    return fetchStatus === 'paused' ? <Offline /> : <Spinner />
  }

  if (isError) {
    if (error instanceof HttpError && error.status === 401) {
      return <SignIn queryKey={query.queryKey} />
    }
    return (
      <div className="signed-in-list--failure">
        <Error message={failureMessage} />
        <button
          type="button"
          className="signed-in-list--button"
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

  const term = normalizeSearchTerm(search)

  if (filtered.length === 0 && term === '') {
    return <Error message={emptyMessage} />
  }

  return (
    <GameGrid
      games={filtered}
      label={label}
      showPrice={false}
      outbound
      trailing={term === '' ? null : <SearchAllCard term={term} />}
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={() => undefined}
    />
  )
}

export default SignedInList
