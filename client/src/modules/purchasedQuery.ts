import { fetchPurchasedGames } from './psnStore'
import { PURCHASED_QUERY_KEY, signedInQueryOptions } from './signedInQuery'

export const purchasedQueryOptions = signedInQueryOptions(
  PURCHASED_QUERY_KEY,
  // The query context must not reach the fetcher: its argument is an abort signal.
  () => fetchPurchasedGames(),
)
