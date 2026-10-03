import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
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
import Purchased from '../components/Purchased'
import { SearchContext } from '../modules/searchContext'

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

const renderPurchased = async (search = '') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  })
  const rootRoute = createRootRoute({
    component: () => (
      <SearchContext.Provider value={search}>
        <Purchased />
      </SearchContext.Provider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const methodsOf = (mock: ReturnType<typeof stubFetch>): string[] =>
  mock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${urlText(url)}`,
  )

describe('Purchased', () => {
  let setItem: ReturnType<typeof vi.spyOn>
  let cookieSet: ReturnType<typeof vi.fn<(value: string) => void>>

  beforeEach(() => {
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
    expect(screen.getByRole('link', { name: /NPSSO/ })).toHaveAttribute(
      'href',
      'https://ca.account.sony.com/api/v1/ssocookie',
    )
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check the token.',
    )
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

  it('renders cards without prices and links out to Sony', async () => {
    stubFetch(() =>
      Response.json(
        library([
          game('10000001', 'Synthetic Alpha', 'concept'),
          game(
            'EP0001-PPSA00002_00-SYNTHETICBETA000',
            'Synthetic Beta',
            'concept',
          ),
        ]),
      ),
    )
    await renderPurchased()

    const alpha = await screen.findByRole('link', { name: /Synthetic Alpha/ })
    expect(alpha).toHaveAttribute(
      'href',
      'https://store.playstation.com/en-fi/concept/10000001',
    )
    expect(
      screen.getByRole('link', { name: /Synthetic Beta/ }),
    ).toHaveAttribute(
      'href',
      'https://store.playstation.com/en-fi/product/EP0001-PPSA00002_00-SYNTHETICBETA000',
    )
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
    cleanup()

    await renderPurchased('zzz')
    expect(await screen.findByText('No games found')).toBeInTheDocument()
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
