import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game, GenreList, PageResult } from '@psstore/shared'
import Browse from '../components/Browse'
import { readBrowseParams } from '../modules/browseParams'
import { SearchContext } from '../modules/searchContext'
import { parseSearch, stringifySearch } from '../modules/searchTerm'

const game = (id: string, name: string): Game => ({
  id,
  name,
  date: '2024-01-01T00:00:00.000Z',
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

const GENRES: GenreList = {
  genres: [
    { key: 'ACTION', name: 'Action' },
    { key: 'MUSIC/RHYTHM', name: 'Music/Rhythm' },
    { key: 'ROLE_PLAYING_GAMES', name: 'Role Playing Games' },
  ],
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const page = (games: Game[], nextOffset: number | null): PageResult => ({
  games,
  totalCount: games.length,
  nextOffset,
})

let browseHandler: (url: URL) => Response
let genresHandler: () => Response
let fetchMock: ReturnType<typeof vi.fn>
let observerCallbacks: IntersectionObserverCallback[]

// Tells every grid sentinel that it scrolled into view.
const scrollToEnd = () => {
  for (const callback of observerCallbacks) {
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  }
}

const browseCalls = (): URL[] =>
  fetchMock.mock.calls
    .map((call) => new URL(String(call[0]), 'http://localhost'))
    .filter((url) => url.pathname === '/api/games/browse')

beforeEach(() => {
  observerCallbacks = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallbacks.push(callback)
      }
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  genresHandler = () => json(GENRES)
  browseHandler = () => json(page([game('EP1-A', 'Alpha')], null))
  fetchMock = vi.fn((input: string) => {
    const url = new URL(input, 'http://localhost')
    return Promise.resolve(
      url.pathname === '/api/games/genres'
        ? genresHandler()
        : browseHandler(url),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderBrowseAt = async (initial: string, term = '') => {
  const rootRoute = createRootRoute({ component: Outlet })
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'browse',
    validateSearch: (
      search: { genre?: unknown; order?: unknown } & SearchSchemaInput,
    ) => readBrowseParams(search),
    component: () => (
      <SearchContext.Provider value={term}>
        <Browse params={browseRoute.useSearch()} />
      </SearchContext.Provider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([browseRoute]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    parseSearch,
    stringifySearch,
  })
  await router.load()
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

// Lets a navigation or a fetch that an event started run to its end, so a
// check after it sees the result and not the state before it.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

const selects = async () => ({
  genre: await screen.findByRole('combobox', { name: 'Genre' }),
  order: screen.getByRole('combobox', { name: 'Order' }),
})

describe('Browse', () => {
  it('opens on an empty form with required selects and no game request', async () => {
    await renderBrowseAt('/browse')
    const { genre, order } = await selects()

    expect(genre).toHaveValue('')
    expect(order).toHaveValue('')
    expect(genre).toBeRequired()
    expect(order).toBeRequired()
    expect(screen.getByRole('button', { name: 'Browse' })).toBeEnabled()
    expect(
      within(genre)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Select genre', 'Action', 'Music/Rhythm', 'Role Playing Games'])
    expect(
      within(order)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Select order',
      'Best selling',
      'Most downloaded',
      'Release date (newest first)',
      'Release date (oldest first)',
      'Name (A–Z)',
      'Name (Z–A)',
    ])
    expect(browseCalls()).toEqual([])
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('does not navigate or fetch while a select is empty', async () => {
    const router = await renderBrowseAt('/browse')
    const { genre } = await selects()

    fireEvent.change(genre, { target: { value: 'ACTION' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Browse PS5 games' }))
    await settle()

    expect(router.state.location.searchStr).toBe('')
    expect(router.state.location.search).toEqual({
      genre: undefined,
      order: undefined,
    })
    expect(browseCalls()).toEqual([])
  })

  it('fetches nothing on a select change, and the list on Browse', async () => {
    const router = await renderBrowseAt('/browse')
    const { genre, order } = await selects()

    fireEvent.change(genre, { target: { value: 'MUSIC/RHYTHM' } })
    await settle()
    fireEvent.change(order, { target: { value: 'most-downloaded' } })
    await settle()
    expect(router.state.location.searchStr).toBe('')
    expect(browseCalls()).toEqual([])
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(router.state.location.searchStr).toBe(
      '?genre=MUSIC%2FRHYTHM&order=most-downloaded',
    )
    expect(browseCalls()).toHaveLength(1)
    const [call] = browseCalls()
    expect(call?.searchParams.get('genre')).toBe('MUSIC/RHYTHM')
    expect(call?.searchParams.get('order')).toBe('most-downloaded')
    expect(call?.searchParams.get('offset')).toBe('0')
    expect(call?.searchParams.get('size')).toBe('60')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Music/Rhythm · Most downloaded',
    )
  })

  it('prefills the form from the URL and shows no count', async () => {
    await renderBrowseAt('/browse?genre=ROLE_PLAYING_GAMES&order=best-selling')
    const { genre, order } = await selects()

    expect(genre).toHaveValue('ROLE_PLAYING_GAMES')
    expect(order).toHaveValue('best-selling')
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Role Playing Games · Best selling',
    )
    expect(screen.queryByText(/\d+ games?/)).toBeNull()
  })

  it.each([
    [
      'an unknown genre',
      '/browse?genre=NOT_A_GENRE&order=newest',
      '',
      'newest',
    ],
    [
      'a malformed genre',
      '/browse?genre=role%20playing&order=newest',
      '',
      'newest',
    ],
    ['an unknown order', '/browse?genre=ACTION&order=price', 'ACTION', ''],
    ['a Sony sort name', '/browse?genre=ACTION&order=sales30', 'ACTION', ''],
  ])(
    'leaves the select empty and fetches nothing for %s',
    async (_label, path, genreValue, orderValue) => {
      await renderBrowseAt(path)
      const { genre, order } = await selects()

      expect(genre).toHaveValue(genreValue)
      expect(order).toHaveValue(orderValue)
      expect(browseCalls()).toEqual([])
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    },
  )

  it('clears the form and the list when the URL loses the selection', async () => {
    const router = await renderBrowseAt('/browse?genre=ACTION&order=newest')
    await screen.findByText('Alpha')

    await router.navigate({ to: '/browse' })

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    })
    const { genre, order } = await selects()
    expect(genre).toHaveValue('')
    expect(order).toHaveValue('')
  })

  it('keeps the shown list until Browse is pressed again', async () => {
    const router = await renderBrowseAt('/browse?genre=ACTION&order=newest')
    const { genre, order } = await selects()
    await screen.findByText('Alpha')

    fireEvent.change(genre, { target: { value: 'MUSIC/RHYTHM' } })
    await settle()
    fireEvent.change(order, { target: { value: 'name-asc' } })
    await settle()

    expect(router.state.location.searchStr).toBe('?genre=ACTION&order=newest')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Action · Release date (newest first)',
    )
    expect(browseCalls()).toHaveLength(1)
  })

  it('removes repeated games across pages and reads past an empty page', async () => {
    browseHandler = (url) => {
      const offset = url.searchParams.get('offset')
      return offset === '0'
        ? json(page([], 60))
        : json(page([game('EP1-A', 'Alpha'), game('EP1-A', 'Alpha')], null))
    }
    await renderBrowseAt('/browse?genre=ACTION&order=newest')

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha')).toHaveLength(1)
    expect(browseCalls().map((url) => url.searchParams.get('offset'))).toEqual([
      '0',
      '60',
    ])
  })

  it('loads the next page at the end of the list', async () => {
    browseHandler = (url) =>
      url.searchParams.get('offset') === '0'
        ? json(page([game('EP1-A', 'Alpha')], 60))
        : json(page([game('EP1-B', 'Beta')], null))
    await renderBrowseAt('/browse?genre=ACTION&order=newest')
    await screen.findByText('Alpha')

    act(scrollToEnd)

    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(browseCalls()).toHaveLength(2)
  })

  it('filters the loaded games by name and loads no further page', async () => {
    browseHandler = () =>
      json(page([game('EP1-A', 'Alpha'), game('EP1-B', 'Beta')], 60))
    await renderBrowseAt('/browse?genre=ACTION&order=newest', 'alp')
    await screen.findByText('Alpha')

    expect(screen.queryByText('Beta')).toBeNull()
    act(scrollToEnd)
    await settle()
    expect(browseCalls()).toHaveLength(1)
  })

  it('says so when the genre has no PS5 game', async () => {
    browseHandler = () => json(page([], null))
    await renderBrowseAt('/browse?genre=ACTION&order=newest')

    const message = await screen.findByText('No PS5 games found in Action')
    expect(message.closest('[role="status"]')).not.toBeNull()
  })

  it('shows an error with Retry when the list fails', async () => {
    browseHandler = () => json({}, 502)
    await renderBrowseAt('/browse?genre=ACTION&order=newest')

    expect(await screen.findByText('Failed to load games')).toBeInTheDocument()
    browseHandler = () => json(page([game('EP1-A', 'Alpha')], null))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })

  it('shows an error with Retry when the genre list fails', async () => {
    genresHandler = () => json({}, 503)
    await renderBrowseAt('/browse?genre=ACTION&order=newest')

    expect(await screen.findByText('Failed to load genres')).toBeInTheDocument()
    expect(browseCalls()).toEqual([])
    genresHandler = () => json(GENRES)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue(
        'ACTION',
      )
    })
  })
})
