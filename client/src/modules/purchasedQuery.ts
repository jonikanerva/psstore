import { fetchPurchasedGames } from './psnStore'
import { PURCHASED_QUERY_KEY, signedInQueryOptions } from './signedInQuery'

export const purchasedQueryOptions = signedInQueryOptions(
  PURCHASED_QUERY_KEY,
  fetchPurchasedGames,
)
