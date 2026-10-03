import { fetchPurchasedGames } from './psnStore'
import { signedInQueryOptions } from './signedInQuery'

export const PURCHASED_QUERY_KEY = ['purchased'] as const

export const purchasedQueryOptions = signedInQueryOptions(
  PURCHASED_QUERY_KEY,
  fetchPurchasedGames,
)
