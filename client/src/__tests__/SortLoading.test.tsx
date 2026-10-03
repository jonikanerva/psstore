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
import Games from '../components/Games'
import { fetchNewGames, fetchUpcomingGames } from '../modules/psnStore'

vi.mock('../modules/psnStore', () => ({
  fetchNewGames: vi.fn(),
  fetchUpcomingGames: vi.fn(),
  fetchDiscountedGames: vi.fn(),
  fetchMonthlyGames: vi.fn(),
  fetchPurchasedGames: vi.fn(),
  fetchWishlistGames: vi.fn(),
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

const game = (id: string, name: string, date = '', price = ''): Game => ({
  id,
  name,
  date,
  url: 'https://example.com/cover.png',
  price,
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

const page = (games: Game[], nextOffset: number | null): PageResult => ({
  games,
  totalCount: 3,
  nextOffset,
})

interface Deferred {
  promise: Promise<PageResult>
  resolve: (value: PageResult) => void
  reject: (reason: Error) => void
}

const deferred = (): Deferred => {
  let resolve: Deferred['resolve'] = () => undefined
  let reject: Deferred['reject'] = () => undefined
  const promise = new Promise<PageResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const renderApp = async (initialPath = '/new') => {
  const rootRoute = createRootRoute({ component: AppShell })
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'new',
    component: () => <Games feature="new" fetch={fetchNewGames} />,
  })
  const upcomingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'upcoming',
    component: () => <Games feature="upcoming" fetch={fetchUpcomingGames} />,
  })
  const monthlyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'monthly',
    component: () => <div>monthly view</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([newRoute, upcomingRoute, monthlyRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const cardNames = (): (string | null)[] =>
  Array.from(document.querySelectorAll('.game-card--name')).map(
    (element) => element.textContent,
  )

const pickName = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
}

describe('sorting a paged view', () => {
  afterEach(() => {
    cleanup()
    vi.mocked(fetchNewGames).mockReset()
    vi.mocked(fetchUpcomingGames).mockReset()
  })

  it('shows the spinner while pages load, then the sorted list', async () => {
    const second = deferred()
    vi.mocked(fetchNewGames)
      .mockResolvedValueOnce(page([game('1', 'Charlie')], 60))
      .mockReturnValueOnce(second.promise)
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()
    expect(fetchNewGames).toHaveBeenCalledTimes(1)

    pickName()

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Loading')
    })
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument()

    await act(async () => {
      second.resolve(page([game('2', 'Alpha'), game('3', 'Bravo')], null))
    })

    await waitFor(() => {
      expect(cardNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    })
    expect(fetchNewGames).toHaveBeenCalledTimes(2)
  })

  it('sorts UPCOMING by price with unpriced games last in both directions', async () => {
    vi.mocked(fetchUpcomingGames).mockResolvedValueOnce(
      page(
        [
          game('1', 'Concept', '2027-01-01T00:00:00Z'),
          game('2', 'Pricey', '2027-02-01T00:00:00Z', '69,99 €'),
          game('3', 'Cheap', '2027-03-01T00:00:00Z', '19,99 €'),
        ],
        null,
      ),
    )
    await renderApp('/upcoming')
    expect(await screen.findByText('Concept')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sort by price' }))
    await waitFor(() => {
      expect(cardNames()).toEqual(['Cheap', 'Pricey', 'Concept'])
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by price, ascending' }),
    )
    await waitFor(() => {
      expect(cardNames()).toEqual(['Pricey', 'Cheap', 'Concept'])
    })
  })

  it('loads nothing while the sort is idle', async () => {
    vi.mocked(fetchNewGames).mockResolvedValueOnce(
      page([game('1', 'Charlie')], 60),
    )
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()
    expect(fetchNewGames).toHaveBeenCalledTimes(1)
  })

  it('loads every page when the default field flips direction', async () => {
    vi.mocked(fetchNewGames)
      .mockResolvedValueOnce(
        page([game('1', 'Charlie', '2025-01-01T00:00:00Z')], 60),
      )
      .mockResolvedValueOnce(
        page([game('2', 'Alpha', '2026-01-01T00:00:00Z')], null),
      )
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()
    expect(fetchNewGames).toHaveBeenCalledTimes(1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort by date, descending' }),
    )

    await waitFor(() => {
      expect(cardNames()).toEqual(['Charlie', 'Alpha'])
    })
    expect(fetchNewGames).toHaveBeenCalledTimes(2)
  })

  it('keeps the server order and loads nothing when Reset is chosen', async () => {
    vi.mocked(fetchNewGames).mockResolvedValueOnce(
      page(
        [
          game('1', 'Charlie', '2025-01-01T00:00:00Z'),
          game('2', 'Alpha', '2026-01-01T00:00:00Z'),
        ],
        null,
      ),
    )
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    await waitFor(() => {
      expect(cardNames()).toEqual(['Alpha', 'Charlie'])
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset sort to the default order' }),
    )
    expect(cardNames()).toEqual(['Charlie', 'Alpha'])
    expect(fetchNewGames).toHaveBeenCalledTimes(1)
  })

  it('stops loading when Reset is chosen while pages are loading', async () => {
    const second = deferred()
    vi.mocked(fetchNewGames)
      .mockResolvedValueOnce(page([game('1', 'Charlie')], 60))
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(page([game('3', 'Bravo')], null))
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()

    pickName()
    await waitFor(() => {
      expect(fetchNewGames).toHaveBeenCalledTimes(2)
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset sort to the default order' }),
    )
    await act(async () => {
      second.resolve(page([game('2', 'Alpha')], 120))
      await Promise.resolve()
    })

    expect(fetchNewGames).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Charlie')).toBeInTheDocument()
  })

  it('shows the error state when a page fails, never a partial list', async () => {
    vi.mocked(fetchNewGames)
      .mockResolvedValueOnce(page([game('1', 'Charlie')], 60))
      .mockRejectedValueOnce(new Error('502'))
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()

    pickName()

    expect(await screen.findByText('Failed to load games')).toBeInTheDocument()
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
  })

  it('stops requesting pages after the route changes', async () => {
    const second = deferred()
    vi.mocked(fetchNewGames)
      .mockResolvedValueOnce(page([game('1', 'Charlie')], 60))
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(page([game('3', 'Bravo')], null))
    await renderApp()
    expect(await screen.findByText('Charlie')).toBeInTheDocument()

    pickName()
    await waitFor(() => {
      expect(fetchNewGames).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(screen.getByRole('link', { name: 'Monthly' }))
    await act(async () => {
      second.resolve(page([game('2', 'Alpha')], 120))
      await Promise.resolve()
    })

    expect(fetchNewGames).toHaveBeenCalledTimes(2)
  })
})
