import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  within,
} from '@testing-library/react'
import type { Game, PageResult } from '@psstore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import Purchased from '../components/Purchased'

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

// Renders the page inside the real shell, so the header controls are present.
const renderPurchased = async (search = '') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  })
  const rootRoute = createRootRoute({ component: AppShell })
  const purchasedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'purchased',
    component: Purchased,
  })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'search',
    component: () => <p>Search view</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([purchasedRoute, searchRoute]),
    history: createMemoryHistory({ initialEntries: ['/purchased'] }),
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

describe('Purchased', () => {
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the sign-in form on 401 with the agreed accessibility', async () => {
    stubFetch(() => status(401))
    await renderPurchased()

    const input = await screen.findByLabelText('NPSSO token')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    const follows = (a: Element, b: Element): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(follows(input, button)).toBe(true)
    expect(follows(button, list)).toBe(true)
    const steps = within(list)
    expect(steps.getAllByRole('listitem')).toHaveLength(3)
    expect(
      steps.getByText('Paste it above and click Sign in.'),
    ).toBeInTheDocument()
    const links = [
      [
        steps.getByRole('link', { name: 'playstation.com' }),
        'https://www.playstation.com/',
      ],
      [
        steps.getByRole('link', { name: 'Get your token here' }),
        'https://ca.account.sony.com/api/v1/ssocookie',
      ],
    ] as const
    for (const [link, href] of links) {
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('sorts the library by name in both directions', async () => {
    stubFetch(() =>
      Response.json(
        library([
          game('10000001', 'Charlie', 'concept'),
          game('10000002', 'alpha', 'concept'),
          game('10000003', 'Bravo', 'concept'),
        ]),
      ),
    )
    await renderPurchased()
    await screen.findByText('Charlie')
    const names = () =>
      screen
        .getAllByRole('link')
        .map((link) => link.textContent)
        .filter((text) => ['Charlie', 'alpha', 'Bravo'].includes(text))
    expect(names()).toEqual(['alpha', 'Bravo', 'Charlie'])

    expect(
      within(screen.getByRole('group', { name: 'Sort:' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Reset', 'Name ↑'])
    expect(
      screen.queryByRole('button', { name: /Sort by date/ }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Sort by name, ascending' }),
    )
    expect(names()).toEqual(['Charlie', 'Bravo', 'alpha'])

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset sort to the default order' }),
    )
    expect(names()).toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  it('posts the token, clears the field and loads the library', async () => {
    let signedIn = false
    const mock = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        signedIn = true
        return status(204)
      }
      return signedIn
        ? Response.json(
            library([game('10000001', 'Synthetic Alpha', 'concept')]),
          )
        : status(401)
    })
    await renderPurchased()

    const input = await screen.findByLabelText<HTMLInputElement>('NPSSO token')
    fireEvent.change(input, { target: { value: TOKEN } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Synthetic Alpha')).toBeInTheDocument()
    const post = mock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[1]?.body).toBe(JSON.stringify({ npsso: TOKEN }))
    expect(post?.[1]?.credentials).toBe('same-origin')
    expect(methodsOf(mock)).toEqual([
      'GET /api/games/purchased',
      'POST /api/session',
      'GET /api/games/purchased',
    ])
  })

  it('clears the field and shows an alert when the token is wrong', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST' ? status(401) : status(401),
    )
    await renderPurchased()

    const input = await screen.findByLabelText<HTMLInputElement>('NPSSO token')
    fireEvent.change(input, { target: { value: TOKEN } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sign-in failed. Check the token.')
    expect(
      Boolean(
        alert.compareDocumentPosition(screen.getByRole('list')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
    expect(input.value).toBe('')
  })

  it('shows a short upstream message when Sony is unavailable', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST' ? status(502) : status(401),
    )
    await renderPurchased()

    fireEvent.change(await screen.findByLabelText('NPSSO token'), {
      target: { value: TOKEN },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sony sign-in is unavailable. Try again later.',
    )
  })

  it('renders cards without prices and links to the game page', async () => {
    stubFetch(() =>
      Response.json(
        library([
          game(
            'EP0001-PPSA00001_00-SYNTHETICALPHA00',
            'Synthetic Alpha',
            'product',
          ),
          game(
            'EP0001-PPSA00002_00-SYNTHETICBETA000',
            'Synthetic Beta',
            'product',
          ),
        ]),
      ),
    )
    await renderPurchased()

    const alpha = await screen.findByRole('link', { name: /Synthetic Alpha/ })
    expect(alpha).toHaveAttribute(
      'href',
      '/g/EP0001-PPSA00001_00-SYNTHETICALPHA00',
    )
    expect(
      screen.getByRole('link', { name: /Synthetic Beta/ }),
    ).toHaveAttribute('href', '/g/EP0001-PPSA00002_00-SYNTHETICBETA000')
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('filters the list by the search text and reports no match', async () => {
    stubFetch(() =>
      Response.json(
        library([
          game('1', 'Synthetic Alpha', 'concept'),
          game('2', 'Synthetic Beta', 'concept'),
        ]),
      ),
    )
    await renderPurchased('beta')
    expect(await screen.findByText('Synthetic Beta')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Alpha')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Press Enter to search all PS5 games for "beta"',
      }),
    ).toBeInTheDocument()
    cleanup()

    await renderPurchased('zzz')
    expect(
      await screen.findByRole('link', {
        name: 'Press Enter to search all PS5 games for "zzz"',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Alpha')).not.toBeInTheDocument()
  })

  it('goes to the global search on Enter once the library is loaded', async () => {
    stubFetch(() =>
      Response.json(library([game('1', 'Synthetic Alpha', 'concept')])),
    )
    await renderPurchased('alp')
    await screen.findByText('Synthetic Alpha')

    fireEvent.submit(screen.getByRole('search'))

    expect(await screen.findByText('Search view')).toBeInTheDocument()
  })

  it('shows no search hint on the sign-in screen and keeps the search disabled', async () => {
    stubFetch(() => status(401))
    await renderPurchased()
    await screen.findByLabelText('NPSSO token')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /Press Enter/ })).toBeNull()
  })

  it('says so when the library is empty', async () => {
    stubFetch(() => Response.json(library([])))
    await renderPurchased()
    expect(
      await screen.findByText('No PS5 games in your library'),
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
    await renderPurchased()

    expect(
      await screen.findByText('Failed to load your library'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Synthetic Alpha')).toBeInTheDocument()
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('shows Sign out in the header only while the list exists', async () => {
    let signedIn = false
    stubFetch((_url, init) => {
      if (init?.method === 'POST') {
        signedIn = true
        return status(204)
      }
      return signedIn
        ? Response.json(library([game('1', 'Synthetic Alpha', 'concept')]))
        : status(401)
    })
    await renderPurchased()
    await screen.findByLabelText('NPSSO token')
    expect(
      screen.queryByRole('button', { name: 'Sign out' }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('NPSSO token'), {
      target: { value: TOKEN },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('Synthetic Alpha')

    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(within(screen.getByRole('banner')).getByText('Sign out')).toBe(
      signOut,
    )
    expect(
      Boolean(
        signOut.compareDocumentPosition(
          screen.getByRole('searchbox', { name: 'Search' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1)
  })

  it('signs out, drops the list and shows the form again', async () => {
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
    await renderPurchased()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText('NPSSO token')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Alpha')).not.toBeInTheDocument()
    expect(methodsOf(mock)).toContain('DELETE /api/session')
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Sign out' }),
      ).not.toBeInTheDocument()
    })
  })

  it('clears the purchased query data on sign-out', async () => {
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
    const { queryClient } = await renderPurchased()
    await screen.findByText('Synthetic Alpha')
    expect(queryClient.getQueryData(['purchased'])).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(queryClient.getQueryData(['purchased'])).toBeUndefined()
    })
    expect(methodsOf(mock)).toContain('DELETE /api/session')
  })

  it('clears the purchased query data when signing out on another view', async () => {
    const mock = stubFetch((_url, init) =>
      init?.method === 'DELETE' ? status(204) : status(500),
    )
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      ['purchased'],
      library([game('1', 'Synthetic Alpha', 'concept')]),
    )
    const rootRoute = createRootRoute({ component: AppShell })
    const newRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: 'new',
      component: () => <p>New view</p>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([newRoute]),
      history: createMemoryHistory({ initialEntries: ['/new'] }),
    })
    await router.load()
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(queryClient.getQueryData(['purchased'])).toBeUndefined()
    })
    expect(methodsOf(mock)).toEqual(['DELETE /api/session'])
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Sign out' }),
      ).not.toBeInTheDocument()
    })
  })

  it('shows an alert and keeps the list when sign-out fails', async () => {
    stubFetch((_url, init) =>
      init?.method === 'DELETE'
        ? status(500)
        : Response.json(library([game('1', 'Synthetic Alpha', 'concept')])),
    )
    await renderPurchased()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-out failed. Try again.',
    )
    expect(screen.getByText('Synthetic Alpha')).toBeInTheDocument()
  })

  it('starts the grid at the top of the page, with no bar above it', async () => {
    stubFetch(() =>
      Response.json(library([game('1', 'Synthetic Alpha', 'concept')])),
    )
    await renderPurchased()
    await screen.findByText('Synthetic Alpha')
    const main = screen.getByRole('main')
    expect(within(main).queryByRole('button')).not.toBeInTheDocument()
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
    await renderPurchased()
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
