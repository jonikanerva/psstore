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
  waitFor,
} from '@testing-library/react'
import type { Game, PageResult } from '@psstore/shared'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import SearchResults from '../components/SearchResults'
import {
  parseSearch,
  readSearchTerm,
  stringifySearch,
} from '../modules/searchTerm'

vi.mock('../modules/usePrefetchTabs', () => ({
  usePrefetchTabs: () => () => undefined,
}))

beforeAll(() => {
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
})

const game = (id: string, name: string, date: string): Game => ({
  id,
  name,
  date,
  url: 'https://example.com/cover.png',
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

const stubSearchFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const body: PageResult = {
        games: [
          game('1', 'Alpha', '2026-01-01T00:00:00Z'),
          game('2', 'Bravo', '2026-02-01T00:00:00Z'),
        ],
        totalCount: 2,
        nextOffset: null,
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )

const renderAt = async (initial: string) => {
  const rootRoute = createRootRoute({ component: AppShell })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'search',
    validateSearch: (search: Record<string, unknown>) => ({
      q: readSearchTerm(search),
    }),
    component: function Search() {
      const { q } = searchRoute.useSearch()
      return <SearchResults term={q} />
    },
  })
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'new',
    component: () => <div>new view</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([searchRoute, newRoute]),
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
}

const cardNames = (): (string | null)[] =>
  Array.from(document.querySelectorAll('.game-card--name')).map(
    (element) => element.textContent,
  )

const submitTerm = (value: string) => {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
    target: { value },
  })
  fireEvent.submit(screen.getByRole('search'))
}

describe('sorting the search results', () => {
  it('shows the sort bar with Date descending active and the newest first', async () => {
    stubSearchFetch()
    await renderAt('/search?q=alp')

    expect(
      await screen.findByRole('button', { name: 'Sort by date, descending' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      expect(cardNames()).toEqual(['Bravo', 'Alpha'])
    })
  })

  it('returns to Date descending when a new term is submitted', async () => {
    stubSearchFetch()
    await renderAt('/search?q=alp')
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    expect(
      screen.getByRole('button', { name: 'Sort by name, ascending' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await act(async () => {
      submitTerm('bra')
    })

    expect(
      await screen.findByRole('button', { name: 'Sort by date, descending' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the chosen sort when the same term is submitted again', async () => {
    stubSearchFetch()
    await renderAt('/search?q=alp')
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    await act(async () => {
      submitTerm('alp')
    })

    expect(
      screen.getByRole('button', { name: 'Sort by name, ascending' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops the sort when the route changes', async () => {
    stubSearchFetch()
    await renderAt('/search?q=alp')
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))

    fireEvent.click(screen.getByRole('link', { name: /new/i }))

    expect(await screen.findByText('new view')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sort by name' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
