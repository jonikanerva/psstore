import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '@psstore/shared'
import AppShell from '../components/AppShell'
import GameGrid from '../components/GameGrid'
import { useSearchQuery } from '../modules/searchContext'
import { useSort } from '../modules/sortContext'

const game = (id: string, idKind: Game['idKind'] = 'product'): Game => ({
  id,
  name: `Name ${id}`,
  date: '',
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
  idKind,
})

let games: readonly Game[] = []

class NoopObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

const List = () => {
  const query = useSearchQuery()
  const sort = useSort()
  return (
    <>
      <div data-testid="query">{query}</div>
      <div data-testid="sort">
        {sort === null ? 'default' : `${sort.field} ${sort.direction}`}
      </div>
      <GameGrid
        games={games}
        label="test"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
      />
    </>
  )
}

const GamePage = () => {
  const router = useRouter()
  return (
    <>
      <button
        type="button"
        onClick={() => {
          router.history.back()
        }}
      >
        Close
      </button>
      <Link to="/g/$gameId" params={{ gameId: 'two' }}>
        Next
      </Link>
    </>
  )
}

const renderApp = async (initial: string) => {
  const root = createRootRoute({ component: AppShell })
  const lists = ['new', 'upcoming', 'search'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: List }),
  )
  const page = createRoute({
    getParentRoute: () => root,
    path: 'g/$gameId',
    component: GamePage,
  })
  const router = createRouter({
    routeTree: root.addChildren([...lists, page]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

type TestRouter = Awaited<ReturnType<typeof renderApp>>

const field = () =>
  screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' })

const goBack = async (router: TestRouter) => {
  act(() => {
    router.history.back()
  })
  await waitFor(() => {
    expect(router.state.location.pathname).not.toMatch(/^\/g\//)
  })
}

const openCard = async (router: TestRouter, id: string) => {
  const link = document.querySelector<HTMLElement>(`a[data-game-id="${id}"]`)
  expect(link).not.toBeNull()
  act(() => {
    link?.click()
  })
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(`/g/${id}`)
  })
}

describe('list view survives a game page round trip', () => {
  beforeEach(() => {
    games = [game('one'), game('two'), game('three')]
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    cleanup()
  })

  it('keeps the sort and the filter', async () => {
    const router = await renderApp('/new')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    fireEvent.change(field(), { target: { value: 'two' } })

    await openCard(router, 'two')
    await goBack(router)

    expect(screen.getByTestId('sort')).toHaveTextContent('name asc')
    expect(screen.getByTestId('query')).toHaveTextContent('two')
    expect(field().value).toBe('two')
  })

  it('resets when another tab is opened from the game page', async () => {
    const router = await renderApp('/new')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    fireEvent.change(field(), { target: { value: 'two' } })
    await openCard(router, 'two')

    fireEvent.click(screen.getByRole('link', { name: 'Upcoming' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/upcoming')
    })
    expect(screen.getByTestId('sort')).toHaveTextContent('default')
    expect(field().value).toBe('')
  })

  it('keeps the state when the same tab is clicked on the game page', async () => {
    const router = await renderApp('/new')
    fireEvent.change(field(), { target: { value: 'two' } })
    await openCard(router, 'two')

    fireEvent.click(screen.getByRole('link', { name: 'New' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/new')
    })
    expect(field().value).toBe('two')
  })

  it('keeps the term and the draft of the search route', async () => {
    const router = await renderApp('/search?q=halo')
    expect(field().value).toBe('halo')
    fireEvent.change(field(), { target: { value: 'halo inf' } })

    await openCard(router, 'two')
    await goBack(router)

    expect(field().value).toBe('halo inf')
    expect(router.state.location.search).toEqual({ q: 'halo' })
  })

  it('resets the search draft when a new term is submitted', async () => {
    await renderApp('/search?q=halo')
    fireEvent.change(field(), { target: { value: 'doom' } })
    fireEvent.submit(field())

    await waitFor(() => {
      expect(field().value).toBe('doom')
    })
  })

  it('starts clean after a deep link to a game page is closed', async () => {
    const router = await renderApp('/g/one')
    act(() => {
      void router.navigate({ to: '/new' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('query')).toBeInTheDocument()
    })
    expect(field().value).toBe('')
    expect(screen.getByTestId('sort')).toHaveTextContent('default')
  })

  it('keeps the state through a game page to game page hop', async () => {
    const router = await renderApp('/new')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    await openCard(router, 'one')
    fireEvent.click(screen.getByRole('link', { name: 'Next' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/g/two')
    })

    act(() => {
      void router.navigate({ to: '/new' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('sort')).toHaveTextContent('name asc')
    })
  })

  it('stores nothing in the browser', async () => {
    const router = await renderApp('/new')
    fireEvent.change(field(), { target: { value: 'two' } })
    await openCard(router, 'two')
    await goBack(router)

    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)
  })
})

describe('focus returns to the opened card', () => {
  beforeEach(() => {
    games = [game('one'), game('two'), game('three')]
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const activeId = () => document.activeElement?.getAttribute('data-game-id')

  it('focuses the card after the close button', async () => {
    const router = await renderApp('/new')
    await openCard(router, 'two')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(activeId()).toBe('two')
    })
  })

  it('focuses the card after browser Back', async () => {
    const router = await renderApp('/new')
    await openCard(router, 'three')
    await goBack(router)
    await waitFor(() => {
      expect(activeId()).toBe('three')
    })
  })

  it('uses preventScroll and scrolls the card into view', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    const router = await renderApp('/new')
    await openCard(router, 'two')
    await goBack(router)
    await waitFor(() => {
      expect(activeId()).toBe('two')
    })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('focuses the first card when the opened card is gone', async () => {
    const router = await renderApp('/new')
    await openCard(router, 'two')
    games = [game('one'), game('three')]
    await goBack(router)
    await waitFor(() => {
      expect(activeId()).toBe('one')
    })
  })

  it('does nothing and does not throw for an empty list', async () => {
    const router = await renderApp('/new')
    await openCard(router, 'two')
    games = []
    await goBack(router)
    expect(document.activeElement).toBe(document.body)
  })

  it('does not steal focus the user already moved', async () => {
    const router = await renderApp('/new')
    await openCard(router, 'two')
    const input = field()
    input.focus()
    await goBack(router)
    expect(document.activeElement).toBe(input)
  })

  it('drops the pending focus when another view opens first', async () => {
    const router = await renderApp('/new')
    await openCard(router, 'two')
    fireEvent.click(screen.getByRole('link', { name: 'Upcoming' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/upcoming')
    })
    expect(document.activeElement).toBe(document.body)

    fireEvent.click(screen.getByRole('link', { name: 'New' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/new')
    })
    expect(document.activeElement).toBe(document.body)
  })

  it('gives a concept card to Sony no data-game-id', async () => {
    games = [game('one'), game('777', 'concept')]
    await renderApp('/new')
    const external = screen.getByRole('link', {
      name: /Name 777 on PlayStation Store/,
    })
    expect(external).not.toHaveAttribute('data-game-id')
  })
})
