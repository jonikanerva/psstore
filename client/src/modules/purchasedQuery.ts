import { queryOptions } from '@tanstack/react-query'
import { fetchPurchasedGames } from './psnStore'

export const PURCHASED_QUERY_KEY = ['purchased'] as const

// Signed-in status is derived from this query: a 401 means signed out. Only a
// user action refetches it (sign-in, retry): no window-focus, reconnect, mount
// or interval refetch, because background refetch of signed-in data is not
// allowed.
export const purchasedQueryOptions = queryOptions({
  queryKey: PURCHASED_QUERY_KEY,
  queryFn: fetchPurchasedGames,
  retry: false,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retryOnMount: false,
})
