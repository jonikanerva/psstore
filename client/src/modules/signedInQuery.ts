import { queryOptions, type QueryKey } from '@tanstack/react-query'
import type { PageResult } from '@psstore/shared'

// Signed-in status is derived from these queries: a 401 means signed out. Only
// a user action refetches them (sign-in, retry): no window-focus, reconnect,
// mount or interval refetch, because background refetch of signed-in data is
// not allowed. None of them is persisted (see persistence.ts).
// Every signed-in query key. A sign-in or sign-out result applies to all of
// them: the keys not on screen are reset, never fetched.
export const SIGNED_IN_QUERY_KEYS = [['purchased'], ['wishlist']] as const

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
