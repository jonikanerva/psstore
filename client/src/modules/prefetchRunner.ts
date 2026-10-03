import {
  hashKey,
  CancelledError,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import type { PageResult } from '@psstore/shared'
import {
  gamesFeatureForPath,
  gamesQueryOptions,
  PAGE_SIZE,
  type GamesFeature,
} from './gamesQuery'
import {
  isSignedInTab,
  nextTab,
  PREFETCH_ORDER,
  type PrefetchTab,
  type SignedInAccess,
} from './prefetchTabs'
import {
  fetchDiscountedGames,
  fetchMonthlyGames,
  fetchPurchasedGames,
  fetchUpcomingGames,
  fetchWishlistGames,
  HttpError,
} from './psnStore'
import { purchasedQueryOptions } from './purchasedQuery'
import { PURCHASED_QUERY_KEY, WISHLIST_QUERY_KEY } from './signedInQuery'
import { wishlistQueryOptions } from './wishlistQuery'

type AbortableGamesFetch = (
  offset: number,
  size: number,
  signal?: AbortSignal,
) => Promise<PageResult>

interface TabQuery {
  readonly queryKey: QueryKey
  // Starts the fetch synchronously. `signal` reaches the HTTP request only.
  readonly start: (client: QueryClient, signal: AbortSignal) => Promise<unknown>
}

// The views build their queries from the same option objects. Only `queryFn`
// differs, to carry the abort signal. `pages: 1` limits a games tab to its
// first page. `retry: false` keeps a failure from sending a second request.
const gamesTab = (
  feature: GamesFeature,
  fetch: AbortableGamesFetch,
): TabQuery => {
  const options = gamesQueryOptions(feature, fetch)
  return {
    queryKey: options.queryKey,
    start: (client, signal) =>
      client.infiniteQuery({
        ...options,
        pages: 1,
        retry: false,

        queryFn: ({ pageParam }) => fetch(pageParam, PAGE_SIZE, signal),
      }),
  }
}

const signedInTab = (
  options: typeof purchasedQueryOptions,
  fetch: (signal: AbortSignal) => Promise<PageResult>,
): TabQuery => ({
  queryKey: options.queryKey,
  start: (client, signal) =>
    client.query({ ...options, queryFn: () => fetch(signal) }),
})

const TAB_QUERIES: Readonly<Record<PrefetchTab, TabQuery>> = {
  upcoming: gamesTab('upcoming', fetchUpcomingGames),
  discounted: gamesTab('discounted', fetchDiscountedGames),
  monthly: gamesTab('monthly', fetchMonthlyGames),
  wishlist: signedInTab(wishlistQueryOptions, fetchWishlistGames),
  purchased: signedInTab(purchasedQueryOptions, fetchPurchasedGames),
}

// Mutable on purpose: one object per page load, owned by the hook that runs
// the prefetch. Fields change only from this module.
export interface PrefetchSession {
  halted: boolean
  access: SignedInAccess
  // Path of the open route; undefined once the shell is gone.
  pathname: string | undefined
  stopSignedIn: (() => void) | null
}

export const createPrefetchSession = (): PrefetchSession => ({
  halted: false,
  access: 'unknown',
  pathname: undefined,
  stopSignedIn: null,
})

// A sign-out ends signed-in prefetch for the page session and aborts the
// request in flight, so no signed-in answer arrives after the reset.
export const stopSignedInPrefetch = (session: PrefetchSession): void => {
  session.access = 'denied'
  session.stopSignedIn?.()
}

const openViewKey = (pathname: string): QueryKey | undefined => {
  const target = gamesFeatureForPath(pathname)
  if (target !== undefined) {
    return gamesQueryOptions(target.feature, target.fetch).queryKey
  }
  if (pathname === '/wishlist') return WISHLIST_QUERY_KEY
  if (pathname === '/purchased') return PURCHASED_QUERY_KEY
  return undefined
}

const findQuery = (client: QueryClient, queryKey: QueryKey) =>
  client.getQueryCache().find({ queryKey, exact: true })

const sameKey = (a: QueryKey | undefined, b: QueryKey): boolean =>
  a !== undefined && hashKey(a) === hashKey(b)

// The open route's view subscribes after the shell's effects run, so the route
// decides before the observer exists.
const isJoined = (
  client: QueryClient,
  session: PrefetchSession,
  queryKey: QueryKey,
): boolean =>
  findQuery(client, queryKey)?.isActive() === true ||
  (session.pathname !== undefined &&
    sameKey(openViewKey(session.pathname), queryKey))

// A tab is covered when it has data or a view that fetches it is open. A
// disabled observer, such as the shell's, is not a view.
const isCovered = (client: QueryClient, tab: PrefetchTab): boolean => {
  const query = findQuery(client, TAB_QUERIES[tab].queryKey)
  return query?.state.status === 'success' || query?.isActive() === true
}

// Prefetch starts only when nothing else fetches and the open tab, if any, has
// settled: the user's own view always goes first.
const isReady = (client: QueryClient, pathname: string): boolean => {
  if (client.isFetching() > 0) return false
  const key = openViewKey(pathname)
  if (key === undefined) return true
  const status = findQuery(client, key)?.state.status
  return status !== undefined && status !== 'pending'
}

const untilReady = (
  client: QueryClient,
  pathname: string,
  signal: AbortSignal,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    if (isReady(client, pathname)) {
      resolve(true)
      return
    }
    const finish = (ready: boolean) => {
      unsubscribe()
      signal.removeEventListener('abort', onAbort)
      resolve(ready)
    }
    const onAbort = () => {
      finish(false)
    }
    const unsubscribe = client.getQueryCache().subscribe(() => {
      if (isReady(client, pathname)) finish(true)
    })
    signal.addEventListener('abort', onAbort, { once: true })
  })

type Outcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'failed'; readonly error: unknown }

// A failed, cancelled or aborted entry leaves no error state behind for a view
// to show. An entry a view fetches stays: the view owns its outcome.
const discardIfUnwatched = (client: QueryClient, queryKey: QueryKey) =>
  client.resetQueries({
    queryKey,
    exact: true,
    predicate: (query) => !query.isActive(),
  })

const prefetchTab = async (
  client: QueryClient,
  session: PrefetchSession,
  tab: PrefetchTab,
  loopSignal: AbortSignal,
): Promise<Outcome> => {
  const { queryKey, start } = TAB_QUERIES[tab]
  const http = new AbortController()

  // A query that a view has joined, or that the open route is about to join,
  // is never aborted: the view needs its answer. `force` is for a sign-out,
  // which discards the answer anyway.
  const abort = (force: boolean) => {
    if (!force && isJoined(client, session, queryKey)) return
    http.abort()
    if (!force) void discardIfUnwatched(client, queryKey)
  }

  const fetching = start(client, http.signal)
  const own = findQuery(client, queryKey)

  // A route change unmounts the old view before the new view subscribes, so
  // the check waits until the commit has finished.
  const onLoopAbort = () => {
    queueMicrotask(() => {
      abort(false)
    })
  }
  loopSignal.addEventListener('abort', onLoopAbort, { once: true })
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      (event.action.type === 'fetch' || event.action.type === 'continue') &&
      event.query !== own
    ) {
      abort(false)
    }
  })
  if (isSignedInTab(tab)) {
    session.stopSignedIn = () => {
      abort(true)
    }
  }

  try {
    await fetching
    return { kind: 'done' }
  } catch (error) {
    void discardIfUnwatched(client, queryKey)
    return http.signal.aborted || error instanceof CancelledError
      ? { kind: 'interrupted' }
      : { kind: 'failed', error }
  } finally {
    unsubscribe()
    loopSignal.removeEventListener('abort', onLoopAbort)
    session.stopSignedIn = null
  }
}

// Fetches the first page of each other tab, one request at a time, only while
// nothing else fetches. Stops for good on a failure. Never rejects.
export const runPrefetch = async (
  client: QueryClient,
  session: PrefetchSession,
  pathname: string,
  signal: AbortSignal,
): Promise<void> => {
  session.pathname = pathname
  // Lets a cleanup that follows at once, as in a double effect, cancel the
  // run before it sends a request.
  await Promise.resolve()
  while (!signal.aborted && !session.halted) {
    if (!(await untilReady(client, pathname, signal))) return
    if (!isReady(client, pathname)) continue
    const tab = nextTab(
      PREFETCH_ORDER,
      (candidate) => isCovered(client, candidate),
      session.access,
    )
    if (tab === null) return
    const outcome = await prefetchTab(client, session, tab, signal)
    if (outcome.kind === 'failed') {
      if (
        isSignedInTab(tab) &&
        outcome.error instanceof HttpError &&
        outcome.error.status === 401
      ) {
        session.access = 'denied'
      } else {
        session.halted = true
      }
    }
  }
}
