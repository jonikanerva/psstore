import { onlineManager } from '@tanstack/react-query'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Game, PageResult } from '@psstore/shared'
import SearchResults from '../components/SearchResults'
import { renderWithRouter } from './testRouter'

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
  onlineManager.setOnline(true)
  vi.unstubAllGlobals()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
})

const game = (id: string, name: string): Game => ({
  id,
  name,
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
  idKind: 'product',
})

const page = (games: Game[], nextOffset: number | null): PageResult => ({
  games,
  totalCount: games.length,
  nextOffset,
})

const respond = (body: PageResult): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const stubFetch = (handler: (url: URL) => Response | Promise<Response>) => {
  const mock = vi.fn((input: string) =>
    Promise.resolve(handler(new URL(input, 'http://localhost'))),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('SearchResults', () => {
  it('shows a loading state, then the games with a result count', async () => {
    stubFetch(() =>
      respond(page([game('EP1-A', 'Alpha'), game('EP1-B', 'Beta')], null)),
    )
    const { container } = await renderWithRouter(<SearchResults term="alp" />)

    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('2 PS5 games found')
  })

  it('requests the encoded term with size 50 from offset 0', async () => {
    const fetchMock = stubFetch(() => respond(page([game('EP1-A', 'A')], null)))
    await renderWithRouter(<SearchResults term={'a & b <c> "d"'} />)

    await screen.findByText('A')
    const url = new URL(fetchMock.mock.calls[0]?.[0] ?? '', 'http://localhost')
    expect(url.pathname).toBe('/api/games/search')
    expect(url.searchParams.get('q')).toBe('a & b <c> "d"')
    expect(url.searchParams.get('offset')).toBe('0')
    expect(url.searchParams.get('size')).toBe('50')
  })

  it('renders the term as literal text in the heading and the empty message', async () => {
    const term = '<b>x</b> & "y"'
    stubFetch(() => respond(page([game('EP1-A', 'Alpha')], null)))
    const found = await renderWithRouter(<SearchResults term={term} />)

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      `Results for "${term}"`,
    )
    expect(found.container.querySelector('b')).toBeNull()
    found.unmount()

    stubFetch(() => respond(page([], null)))
    const none = await renderWithRouter(<SearchResults term={term} />)

    expect(
      await screen.findByText(`No PS5 games found for "${term}"`),
    ).toBeInTheDocument()
    expect(none.container.querySelector('b')).toBeNull()
  })

  it('shows the empty state for a last page without games', async () => {
    stubFetch(() => respond(page([], null)))
    await renderWithRouter(<SearchResults term="xyzzyqq" />)

    expect(
      await screen.findByText('No PS5 games found for "xyzzyqq"'),
    ).toBeInTheDocument()
  })

  it('shows an error with a retry that fetches again', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      return calls === 1
        ? new Response('', { status: 502 })
        : respond(page([game('EP1-A', 'Alpha')], null))
    })
    await renderWithRouter(<SearchResults term="alp" />)

    expect(await screen.findByText('Search failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })

  it('shows an offline message and does not call the server', async () => {
    onlineManager.setOnline(false)
    const fetchMock = stubFetch(() => respond(page([], null)))
    await renderWithRouter(<SearchResults term="alp" />)

    expect(
      await screen.findByText(
        'You are offline. Games load when the connection returns.',
      ),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never moves focus and keeps the heading out of the tab order', async () => {
    stubFetch(() => respond(page([game('EP1-A', 'Alpha')], null)))
    await renderWithRouter(<SearchResults term="alp" />)

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).not.toHaveFocus()
    expect(heading).not.toHaveAttribute('tabindex')
    expect(document.body).toHaveFocus()
  })

  it('has one heading with the term and announces the count in a live region', async () => {
    stubFetch(() => respond(page([game('EP1-A', 'Alpha')], null)))
    await renderWithRouter(<SearchResults term="alp" />)

    await screen.findByText('Alpha')
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Results for "alp"',
    )
    expect(screen.getByRole('status')).toHaveTextContent('1 PS5 game found')
  })

  it('shows one plain message and no heading when nothing matches', async () => {
    stubFetch(() => respond(page([], null)))
    const { container } = await renderWithRouter(
      <SearchResults term="sniperss" />,
    )

    const message = await screen.findByText('No PS5 games found for "sniperss"')
    expect(message).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByRole('status')).toContainElement(message)
    expect(container.textContent.split('sniperss')).toHaveLength(2)
  })

  it('stops at a null nextOffset even when the page holds fewer than 50 games', async () => {
    const fetchMock = stubFetch(() =>
      respond(page([game('EP1-A', 'Alpha')], null)),
    )
    await renderWithRouter(<SearchResults term="alp" />)

    await screen.findByText('Alpha')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reads the next page from the server nextOffset and dedupes by id', async () => {
    const fetchMock = stubFetch((url) =>
      url.searchParams.get('offset') === '0'
        ? respond(page([game('EP1-A', 'Alpha')], 50))
        : respond(page([game('EP1-A', 'Alpha'), game('EP1-B', 'Beta')], null)),
    )
    // The sentinel observer fires at once so the second page loads.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          queueMicrotask(() => {
            callback([{ isIntersecting: true }])
          })
        }
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
    await renderWithRouter(<SearchResults term="alp" />)

    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha')).toHaveLength(1)
    const offsets = fetchMock.mock.calls.map((call) =>
      new URL(call[0], 'http://localhost').searchParams.get('offset'),
    )
    expect(offsets).toEqual(['0', '50'])
    expect(screen.getByRole('status')).toHaveTextContent('2 PS5 games found')
  })

  it('keeps reading when a page holds no games but more pages exist', async () => {
    const fetchMock = stubFetch((url) =>
      url.searchParams.get('offset') === '0'
        ? respond(page([], 150))
        : respond(page([game('EP1-A', 'Alpha')], null)),
    )
    await renderWithRouter(<SearchResults term="the" />)

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(
      screen.queryByText('No PS5 games found for "the"'),
    ).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
