import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { StrictMode } from 'react'
import type { Game, PageResult } from '@psstore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import Games from '../components/Games'
import Purchased from '../components/Purchased'
import Wishlist from '../components/Wishlist'
import { gamesQueryOptions } from '../modules/gamesQuery'
import {
  fetchDiscountedGames,
  fetchMonthlyGames,
  fetchNewGames,
  fetchUpcomingGames,
} from '../modules/psnStore'

const game = (id: string, name: string): Game => ({
  id,
  name,
  date: '2025-09-18T17:00:00Z',
  url: 'https://img.test/x.png',
  price: '',
  originalPrice: '',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind: 'product',
})

const pageOf = (name: string, nextOffset: number | null): Response =>
  Response.json({
    games: [game(name, name)],
    totalCount: 120,
    nextOffset,
  } satisfies PageResult)

const status = (code: number): Response => new Response(null, { status: code })

interface Call {
  readonly url: string
  readonly method: string
  readonly signal: AbortSignal | null | undefined
  answered: boolean
  readonly respond: (response: Response) => void
}

let calls: Call[] = []

const urlText = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const stubFetch = () => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
          calls.push({
            url: urlText(input),
            method: init?.method ?? 'GET',
            signal: init?.signal,
            answered: false,
            respond: resolve,
          })
        }),
    ),
  )
}

const requests = (): string[] =>
  calls.map((call) => `${call.method} ${call.url}`)

const callsTo = (prefix: string): Call[] =>
  calls.filter((call) => call.url.startsWith(prefix))

const unanswered = (): Call[] =>
  calls.filter((call) => !call.answered && call.signal?.aborted !== true)

// Answers the oldest unanswered call to `prefix`, waiting for it to appear.
const answer = async (prefix: string, response: Response): Promise<Call> => {
  let found: Call | undefined
  await waitFor(() => {
    found = calls.find((call) => call.url.startsWith(prefix) && !call.answered)
    expect(found).toBeDefined()
  })
  const call = found as Call
  call.answered = true
  await act(() => {
    call.respond(response)
    return Promise.resolve()
  })
  return call
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

const NEW = '/api/games/new'
const UPCOMING = '/api/games/upcoming'
const DISCOUNTED = '/api/games/discounted'
const MONTHLY = '/api/games/monthly'
const WISHLIST = '/api/games/wishlist'
const PURCHASED = '/api/games/purchased'

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 300_000, retry: 1 } },
  })

const buildRouter = (initial: string) => {
  const rootRoute = createRootRoute({ component: AppShell })
  const feature = (path: string, element: () => React.JSX.Element) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: element })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      feature('new', () => <Games feature="new" fetch={fetchNewGames} />),
      feature('upcoming', () => (
        <Games feature="upcoming" fetch={fetchUpcomingGames} />
      )),
      feature('discounted', () => (
        <Games feature="discounted" fetch={fetchDiscountedGames} />
      )),
      feature('monthly', () => (
        <Games feature="monthly" fetch={fetchMonthlyGames} />
      )),
      feature('wishlist', Wishlist),
      feature('purchased', Purchased),
      feature('other', () => <p>Other page</p>),
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  return router
}

const renderApp = async (initial: string, client = newClient()) => {
  const router = buildRouter(initial)
  await router.load()
  const result = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
  return { ...result, client }
}

const preload = (client: QueryClient, feature: string) => {
  client.setQueryData(['games', feature], {
    pages: [{ games: [], totalCount: 0, nextOffset: 60 }],
    pageParams: [0],
  })
}

// Opens NEW and lets it finish, which starts the prefetch.
const openNew = async (client = newClient()) => {
  const app = await renderApp('/new', client)
  await answer(NEW, pageOf('Synthetic New', 60))
  await screen.findByText('Synthetic New')
  return app
}

describe('usePrefetchTabs', () => {
  beforeEach(() => {
    stubFetch()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('waits for the open tab, then follows the order one request at a time', async () => {
    const client = newClient()
    await renderApp('/new', client)
    await settle()
    expect(requests()).toEqual([expect.stringContaining(NEW)])

    await answer(NEW, pageOf('Synthetic New', 60))
    for (const prefix of [UPCOMING, DISCOUNTED, MONTHLY]) {
      await waitFor(() => {
        expect(callsTo(prefix)).toHaveLength(1)
      })
      expect(unanswered()).toHaveLength(1)
      await answer(prefix, pageOf('Synthetic Tab', 60))
    }
    await answer(
      WISHLIST,
      Response.json({ games: [], totalCount: 0, nextOffset: null }),
    )
    await answer(
      PURCHASED,
      Response.json({ games: [], totalCount: 0, nextOffset: null }),
    )
    await settle()

    expect(calls.map((call) => call.url.split('?')[0])).toEqual([
      NEW,
      UPCOMING,
      DISCOUNTED,
      MONTHLY,
      WISHLIST,
      PURCHASED,
    ])
    expect(callsTo(UPCOMING)[0]?.url).toContain('offset=0&size=60')
  })

  it('leaves a prefetched games tab with a next page, like an unprefetched view', async () => {
    const client = newClient()
    await openNew(client)
    await answer(UPCOMING, pageOf('Synthetic Upcoming', 60))
    await settle()

    const prefetched = new InfiniteQueryObserver(
      client,
      gamesQueryOptions('upcoming', fetchUpcomingGames),
    ).getCurrentResult()
    expect(prefetched.data?.pages).toHaveLength(1)
    expect(prefetched.hasNextPage).toBe(true)
  })

  it('skips a tab that already has data', async () => {
    const client = newClient()
    preload(client, 'upcoming')
    preload(client, 'monthly')
    await openNew(client)

    await answer(DISCOUNTED, pageOf('Synthetic Tab', 60))
    await answer(WISHLIST, status(401))
    await settle()
    expect(callsTo(UPCOMING)).toHaveLength(0)
    expect(callsTo(MONTHLY)).toHaveLength(0)
  })

  it('treats a 401 as silent, stops the signed-in prefetch and leaves no entry', async () => {
    const client = newClient()
    preload(client, 'upcoming')
    preload(client, 'discounted')
    preload(client, 'monthly')
    await openNew(client)

    await answer(WISHLIST, status(401))
    await settle()

    expect(callsTo(PURCHASED)).toHaveLength(0)
    const state = client.getQueryState(['wishlist'])
    expect(state?.status).toBe('pending')
    expect(state?.data).toBeUndefined()
    expect(state?.error).toBeNull()
    expect(screen.queryByLabelText('NPSSO token')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([429, 503])('stops everything after a %i', async (code) => {
    const client = newClient()
    preload(client, 'upcoming')
    await openNew(client)

    await answer(DISCOUNTED, status(code))
    await settle()

    expect(calls.map((call) => call.url.split('?')[0])).toEqual([
      NEW,
      DISCOUNTED,
    ])
    expect(client.getQueryState(['games', 'discounted'])?.status).toBe(
      'pending',
    )
  })

  it('stops everything after a network failure', async () => {
    await openNew()
    await answer(UPCOMING, status(500))
    await settle()
    expect(callsTo(DISCOUNTED)).toHaveLength(0)
  })

  it('aborts the request on a route change and resumes when idle', async () => {
    const client = newClient()
    await openNew(client)
    const upcoming = await waitFor(() => {
      const call = callsTo(UPCOMING)[0]
      expect(call).toBeDefined()
      return call as Call
    })
    expect(upcoming.signal?.aborted).toBe(false)

    fireEvent.click(screen.getByRole('link', { name: 'Discounted' }))
    await waitFor(() => {
      expect(upcoming.signal?.aborted).toBe(true)
    })
    expect(client.getQueryState(['games', 'upcoming'])?.status).toBe('pending')
    expect(client.getQueryState(['games', 'upcoming'])?.error).toBeNull()
    expect(callsTo(UPCOMING)).toHaveLength(1)

    await answer(DISCOUNTED, pageOf('Synthetic Discounted', null))
    await waitFor(() => {
      expect(callsTo(UPCOMING)).toHaveLength(2)
    })
    expect(unanswered()).toHaveLength(1)
  })

  it('aborts the request when the open view asks for its next page', async () => {
    const client = newClient()
    await openNew(client)
    const upcoming = await waitFor(() => {
      const call = callsTo(UPCOMING)[0]
      expect(call).toBeDefined()
      return call as Call
    })

    void new InfiniteQueryObserver(
      client,
      gamesQueryOptions('new', fetchNewGames),
    ).fetchNextPage()

    await waitFor(() => {
      expect(upcoming.signal?.aborted).toBe(true)
    })
    await answer(`${NEW}?offset=60`, pageOf('Synthetic New Two', null))
    await waitFor(() => {
      expect(callsTo(UPCOMING)).toHaveLength(2)
    })
  })

  it('does not cancel or repeat a request that the user opens the tab for', async () => {
    const client = newClient()
    await openNew(client)
    const upcoming = await waitFor(() => {
      const call = callsTo(UPCOMING)[0]
      expect(call).toBeDefined()
      return call as Call
    })

    fireEvent.click(screen.getByRole('link', { name: 'Upcoming' }))
    await settle()
    expect(upcoming.signal?.aborted).toBe(false)
    expect(callsTo(UPCOMING)).toHaveLength(1)

    await answer(UPCOMING, pageOf('Synthetic Upcoming', 60))
    expect(await screen.findByText('Synthetic Upcoming')).toBeInTheDocument()
    await waitFor(() => {
      expect(callsTo(DISCOUNTED)).toHaveLength(1)
    })
    expect(callsTo(UPCOMING)).toHaveLength(1)
  })

  it('aborts a signed-in request on sign-out and does not repopulate', async () => {
    const client = newClient()
    preload(client, 'upcoming')
    preload(client, 'discounted')
    preload(client, 'monthly')
    await openNew(client)
    await answer(
      WISHLIST,
      Response.json({
        games: [game('1', 'Synthetic Wish')],
        totalCount: 1,
        nextOffset: null,
      }),
    )
    const purchased = await waitFor(() => {
      const call = callsTo(PURCHASED)[0]
      expect(call).toBeDefined()
      return call as Call
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(purchased.signal?.aborted).toBe(true)
    })
    await answer('/api/session', status(204))
    await settle()

    expect(client.getQueryData(['purchased'])).toBeUndefined()
    expect(client.getQueryData(['wishlist'])).toBeUndefined()
    expect(callsTo(PURCHASED)).toHaveLength(1)
    expect(callsTo(WISHLIST)).toHaveLength(1)
  })

  it('aborts the request when the shell unmounts', async () => {
    const { unmount } = await openNew()
    const upcoming = await waitFor(() => {
      const call = callsTo(UPCOMING)[0]
      expect(call).toBeDefined()
      return call as Call
    })
    unmount()
    await waitFor(() => {
      expect(upcoming.signal?.aborted).toBe(true)
    })
  })

  it('does not run before the persisted cache is restored', async () => {
    let finish: () => void = () => undefined
    const restored = new Promise<undefined>((resolve) => {
      finish = () => {
        resolve(undefined)
      }
    })
    const router = buildRouter('/other')
    await router.load()
    render(
      <PersistQueryClientProvider
        client={newClient()}
        persistOptions={{
          persister: {
            persistClient: () => Promise.resolve(),
            restoreClient: () => restored,
            removeClient: () => Promise.resolve(),
          },
        }}
      >
        <RouterProvider router={router} />
      </PersistQueryClientProvider>,
    )
    await settle()
    expect(calls).toHaveLength(0)

    await act(() => {
      finish()
      return restored.then(() => undefined)
    })
    await waitFor(() => {
      expect(callsTo(UPCOMING)).toHaveLength(1)
    })
  })
})
