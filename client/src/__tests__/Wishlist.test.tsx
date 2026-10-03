import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { Game, PageResult } from '@psstore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import Purchased from '../components/Purchased'
import Wishlist from '../components/Wishlist'

// The prefetch has its own tests; here it would add requests to the counts.
vi.mock('../modules/usePrefetchTabs', () => ({
  usePrefetchTabs: () => () => undefined,
}))

const game = (id: string, name: string, idKind: Game['idKind']): Game => ({
  id,
  name,
  date: '',
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
  idKind,
})

const library = (games: Game[]): PageResult => ({
  games,
  totalCount: games.length,
  nextOffset: null,
})

const TOKEN = 'synthetic-npsso-0123456789abcdef'

const urlText = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

type Responder = (url: string, init: RequestInit | undefined) => Response

const stubFetch = (responder: Responder) => {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(responder(urlText(input), init)),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

const status = (code: number): Response => new Response(null, { status: code })

// Renders the views inside the real shell, so the header controls are present.
const renderWishlist = async (search = '', initial = '/wishlist') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  })
  const rootRoute = createRootRoute({ component: AppShell })
  const purchasedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'purchased',
    component: Purchased,
  })
  const wishlistRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'wishlist',
    component: Wishlist,
  })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'search',
    component: () => <p>Search view</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      purchasedRoute,
      wishlistRoute,
      searchRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  await router.load()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  if (search !== '') {
    const box = await screen.findByRole('searchbox', { name: 'Search' })
    await waitFor(() => {
      expect(box).toBeEnabled()
    })
    fireEvent.change(box, { target: { value: search } })
  }
  return { ...result, queryClient }
}

const methodsOf = (mock: ReturnType<typeof stubFetch>): string[] =>
  mock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${urlText(url)}`,
  )

const sessionOk = (init: RequestInit | undefined): Response | null =>
  init?.method === 'POST' || init?.method === 'DELETE' ? status(204) : null

describe('Wishlist', () => {
  let setItem: ReturnType<typeof vi.spyOn>
  let cookieSet: ReturnType<typeof vi.fn<(value: string) => void>>

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
    setItem = vi.spyOn(Storage.prototype, 'setItem')
    cookieSet = vi.fn<(value: string) => void>()
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: cookieSet,
    })
  })

  afterEach(() => {
    cleanup()
    onlineManager.setOnline(true)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('requests only GET /api/games/wishlist, same-origin and uncached', async () => {
    const mock = stubFetch(() =>
      Response.json(library([game('10000001', 'Synthetic Alpha', 'concept')])),
    )
    await renderWishlist()
    await screen.findByText('Synthetic Alpha')
    expect(methodsOf(mock)).toEqual(['GET /api/games/wishlist'])
    expect(mock.mock.calls[0]?.[1]?.cache).toBe('no-store')
    expect(mock.mock.calls[0]?.[1]?.credentials).toBe('same-origin')
  })

  it('shows the sign-in form on 401', async () => {
    stubFetch(() => status(401))
    await renderWishlist()
    expect(await screen.findByLabelText('NPSSO token')).toHaveAttribute(
      'type',
      'password',
    )
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeDisabled()
  })

  it('renders full cards that open the internal game page, never Sony', async () => {
    stubFetch(() =>
      Response.json(
        library([
          {
            ...game(
              'EP0001-PPSA00002_00-SYNTHETICBETA000',
              'Synthetic Beta',
              'product',
            ),
            date: '2025-01-02T00:00:00.000Z',
            price: '€39,99',
            originalPrice: '€59,99',
            discountText: '-33%',
            plusOffer: { kind: 'price', price: '€29,99' },
          },
          game('10000001', 'Synthetic Alpha', 'concept'),
        ]),
      ),
    )
    await renderWishlist()
    const beta = await screen.findByRole('link', { name: /Synthetic Beta/ })
    expect(beta).toHaveAttribute(
      'href',
      '/g/EP0001-PPSA00002_00-SYNTHETICBETA000',
    )
    expect(beta).toHaveTextContent('€39,99')
    expect(beta).toHaveTextContent('€59,99')
    const alpha = screen.getByRole('link', { name: /Synthetic Alpha/ })
    expect(alpha).toHaveAttribute('href', '/g/10000001')
    expect(alpha).not.toHaveAttribute('target')
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toContain(
        'store.playstation.com',
      )
    }
  })

  it('applies the default date sort at once and sorts by every pill, entries lacking a value last', async () => {
    stubFetch(() =>
      Response.json(
        library([
          {
            ...game('EP0001-PPSA00001_00-SYNTHETICALPHA00', 'Alpha', 'product'),
            date: '2025-03-01T00:00:00.000Z',
            price: '€59,99',
          },
          game('10000002', 'Bravo', 'concept'),
          {
            ...game(
              'EP0001-PPSA00003_00-SYNTHETICGAMMA000',
              'Gamma',
              'product',
            ),
            date: '2026-01-15T00:00:00.000Z',
            price: '€19,99',
          },
        ]),
      ),
    )
    await renderWishlist()
    const names = () =>
      Array.from(document.querySelectorAll('.game-card--name')).map(
        (element) => element.textContent,
      )
    await screen.findByText('Alpha')
    // Sony's order here is Alpha, Bravo, Gamma. The default pill is Date
    // descending, so the list is already sorted that way.
    expect(names()).toEqual(['Gamma', 'Alpha', 'Bravo'])
    expect(screen.getByRole('link', { name: /Gamma/ })).toHaveTextContent(
      '15 Jan 2026',
    )
    expect(screen.getByRole('link', { name: /Bravo/ })).not.toHaveTextContent(
      /\d{4}/u,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by date, descending' }),
    )
    expect(names()).toEqual(['Alpha', 'Gamma', 'Bravo'])

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by date, ascending' }),
    )
    expect(names()).toEqual(['Gamma', 'Alpha', 'Bravo'])

    fireEvent.click(screen.getByRole('button', { name: 'Sort by price' }))
    expect(names()).toEqual(['Gamma', 'Alpha', 'Bravo'])
    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by price, ascending' }),
    )
    expect(names()).toEqual(['Alpha', 'Gamma', 'Bravo'])

    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    expect(names()).toEqual(['Alpha', 'Bravo', 'Gamma'])
    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by name, ascending' }),
    )
    expect(names()).toEqual(['Gamma', 'Bravo', 'Alpha'])

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset sort to the default order' }),
    )
    expect(names()).toEqual(['Gamma', 'Alpha', 'Bravo'])
    expect(
      screen.getByRole('button', { name: 'Sort by date, descending' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('says so when the wishlist is empty', async () => {
    stubFetch(() => Response.json(library([])))
    await renderWishlist()
    expect(
      await screen.findByText('No PS5 games on your wishlist'),
    ).toBeInTheDocument()
  })

  it('offers a retry after a Sony failure', async () => {
    let calls = 0
    const mock = stubFetch(() => {
      calls += 1
      return calls === 1
        ? status(502)
        : Response.json(library([game('1', 'Synthetic Alpha', 'concept')]))
    })
    await renderWishlist()
    expect(
      await screen.findByText('Failed to load your wishlist'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Synthetic Alpha')).toBeInTheDocument()
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('shows the offline state while the browser is offline', async () => {
    onlineManager.setOnline(false)
    const mock = stubFetch(() => Response.json(library([])))
    await renderWishlist()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are offline',
    )
    expect(mock).not.toHaveBeenCalled()
  })

  it('filters by the search text like PURCHASED does', async () => {
    stubFetch(() =>
      Response.json(
        library([
          game('1', 'Synthetic Alpha', 'concept'),
          game('2', 'Synthetic Beta', 'concept'),
        ]),
      ),
    )
    await renderWishlist('beta')
    expect(await screen.findByText('Synthetic Beta')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Alpha')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Press Enter to search all PS5 games for "beta"',
      }),
    ).toBeInTheDocument()
  })

  it('signs in on the wishlist view without a hidden purchased request', async () => {
    let signedIn = false
    const mock = stubFetch((_url, init) => {
      const session = sessionOk(init)
      if (session !== null) {
        signedIn = true
        return session
      }
      return signedIn
        ? Response.json(library([game('1', 'Synthetic Alpha', 'concept')]))
        : status(401)
    })
    await renderWishlist()
    fireEvent.change(await screen.findByLabelText('NPSSO token'), {
      target: { value: TOKEN },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Synthetic Alpha')).toBeInTheDocument()
    expect(methodsOf(mock)).toEqual([
      'GET /api/games/wishlist',
      'POST /api/session',
      'GET /api/games/wishlist',
    ])
  })

  it('resets the other signed-in list on sign-in, so it loads once on its own view', async () => {
    let signedIn = false
    const mock = stubFetch((url, init) => {
      const session = sessionOk(init)
      if (session !== null) {
        signedIn = true
        return session
      }
      return signedIn
        ? Response.json(library([game('1', 'Synthetic Alpha', 'concept')]))
        : status(401)
    })
    const { queryClient } = await renderWishlist()
    await screen.findByLabelText('NPSSO token')
    queryClient.setQueryData(['purchased'], library([]))
    fireEvent.change(screen.getByLabelText('NPSSO token'), {
      target: { value: TOKEN },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('Synthetic Alpha')
    expect(queryClient.getQueryData(['purchased'])).toBeUndefined()
    expect(methodsOf(mock)).not.toContain('GET /api/games/purchased')
  })

  it('shows Sign out when only the wishlist exists and resets both lists', async () => {
    let signedOut = false
    const mock = stubFetch((_url, init) => {
      if (init?.method === 'DELETE') {
        signedOut = true
        return status(204)
      }
      return signedOut
        ? status(401)
        : Response.json(library([game('1', 'Synthetic Alpha', 'concept')]))
    })
    const { queryClient } = await renderWishlist()
    await screen.findByText('Synthetic Alpha')
    queryClient.setQueryData(['purchased'], library([]))

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText('NPSSO token')).toBeInTheDocument()
    await waitFor(() => {
      expect(queryClient.getQueryData(['purchased'])).toBeUndefined()
      expect(queryClient.getQueryData(['wishlist'])).toBeUndefined()
    })
    expect(methodsOf(mock)).not.toContain('GET /api/games/purchased')
  })

  it('shares the signed-out state: a 401 on either list shows the form', async () => {
    stubFetch(() => status(401))
    await renderWishlist('', '/purchased')
    expect(await screen.findByLabelText('NPSSO token')).toBeInTheDocument()
    cleanup()
    await renderWishlist('', '/wishlist')
    expect(await screen.findByLabelText('NPSSO token')).toBeInTheDocument()
  })

  it('never writes the token or the list to browser storage', async () => {
    let signedIn = false
    stubFetch((_url, init) => {
      if (init?.method === 'POST') {
        signedIn = true
        return status(204)
      }
      if (init?.method === 'DELETE') {
        signedIn = false
        return status(204)
      }
      return signedIn
        ? Response.json(library([game('1', 'Synthetic Alpha', 'concept')]))
        : status(401)
    })
    await renderWishlist()
    fireEvent.change(await screen.findByLabelText('NPSSO token'), {
      target: { value: TOKEN },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('Synthetic Alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByLabelText('NPSSO token')
    await waitFor(() => {
      expect(setItem).not.toHaveBeenCalled()
    })
    expect(cookieSet).not.toHaveBeenCalled()
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN)
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TOKEN)
  })
})
