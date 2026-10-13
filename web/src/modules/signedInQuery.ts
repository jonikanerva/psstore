import { queryOptions, type QueryKey } from '@tanstack/react-query'
import type { PageResult } from '@psstore/shared'

export const PURCHASED_QUERY_KEY = ['purchased'] as const
export const WISHLIST_QUERY_KEY = ['wishlist'] as const

// A sign-in or sign-out applies to every key here: the keys not on screen are
// reset, never fetched.
export const SIGNED_IN_QUERY_KEYS = [
  PURCHASED_QUERY_KEY,
  WISHLIST_QUERY_KEY,
] as const

// Only a user action (sign-in, retry) or the once-per-page-load tab prefetch
// fetches: no window-focus, reconnect, mount or interval refetch.
export const signedInQueryOptions = (
  queryKey: QueryKey,
  queryFn: () => Promise<PageResult>,
) =>
  queryOptions({
    queryKey,
    queryFn,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retryOnMount: false,
  })
