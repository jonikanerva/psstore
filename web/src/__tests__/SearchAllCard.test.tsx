import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game, PageResult } from '@psstore/shared'
import AppShell from '../components/AppShell'
import Games from '../components/Games'
import { fetchNewGames } from '../modules/psnStore'
import {
  parseSearch,
  readSearchTerm,
  stringifySearch,
} from '../modules/searchTerm'

const game = (id: string, name: string): Game => ({
  id,
  name,
  date: '2025-09-18T17:00:00Z',
  url: 'https://example.com/cover.png',
  price: '€9,99',
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

let games: Game[] = []

beforeEach(() => {
  games = [game('EP1-A', 'Alpha Quest'), game('EP1-B', 'Beta Racer')]
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            games,
            totalCount: games.length,
            nextOffset: null,
          } satisfies PageResult),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderAt = async (initial: string) => {
  const rootRoute = createRootRoute({ component: AppShell })
  const list = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <Games feature="new" fetch={fetchNewGames} />,
    })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'search',
    validateSearch: (search: Record<string, unknown>) => ({
      q: readSearchTerm(search),
    }),
    component: () => <div data-testid="search-page" />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      list('new'),
      list('discounted'),
      searchRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    parseSearch,
    stringifySearch,
  })
  await router.load()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findByText('Alpha Quest')
  return router
}

const type = (value: string) => {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
    target: { value },
  })
}

const cardName = (term: string) =>
  `Press Enter to search all PS5 games for "${term}"`

describe('search-all card in a list view', () => {
  it('ends the filtered grid with a link to the global search', async () => {
    await renderAt('/new')

    type('alpha')

    const card = await screen.findByRole('link', { name: cardName('alpha') })
    expect(card).toHaveAttribute('href', '/search?q=alpha')
    expect(card.parentElement?.lastElementChild).toBe(card)
    expect(screen.getByText('Alpha Quest')).toBeInTheDocument()
    expect(screen.queryByText('Beta Racer')).toBeNull()
  })

  it('is the only content when the filter matches nothing', async () => {
    await renderAt('/new')

    type('sniperss')

    const card = await screen.findByRole('link', { name: cardName('sniperss') })
    const grid = card.parentElement
    expect(grid && within(grid).getAllByRole('link')).toEqual([card])
    expect(screen.queryByText('No games found')).toBeNull()
  })

  it('does not show for an empty or whitespace-only field', async () => {
    await renderAt('/new')

    expect(screen.queryByRole('link', { name: /Press Enter/ })).toBeNull()
    type('   ')
    expect(screen.queryByRole('link', { name: /Press Enter/ })).toBeNull()
  })

  it('shows the trimmed term as literal text', async () => {
    await renderAt('/new')
    const term = '<b>x</b> & "y"'

    type(`  ${term}  `)

    const card = await screen.findByRole('link', { name: cardName(term) })
    expect(card.querySelector('b')).toBeNull()
    expect(card.textContent).toBe(cardName(term))
  })

  it('opens the global search when the card is clicked', async () => {
    const router = await renderAt('/new')

    type('alpha')
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('link', { name: cardName('alpha') }),
      )
      await router.load()
    })

    expect(router.state.location.pathname).toBe('/search')
    expect(router.state.location.search).toEqual({ q: 'alpha' })
  })

  it('shows again on every new typing after an earlier search', async () => {
    const router = await renderAt('/new')

    type('alpha')
    await act(async () => {
      fireEvent.submit(screen.getByRole('search'))
      await router.load()
    })
    expect(router.state.location.pathname).toBe('/search')

    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: 'Discounted' }))
      await router.load()
    })
    await screen.findByText('Alpha Quest')
    expect(screen.queryByRole('link', { name: /Press Enter/ })).toBeNull()

    type('beta')
    expect(
      await screen.findByRole('link', { name: cardName('beta') }),
    ).toBeInTheDocument()

    await act(async () => {
      router.history.back()
      await router.load()
    })
    await act(async () => {
      router.history.back()
      await router.load()
    })
    await screen.findByText('Alpha Quest')
    type('gamma')
    expect(
      await screen.findByRole('link', { name: cardName('gamma') }),
    ).toBeInTheDocument()
  })
})
