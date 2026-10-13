import { onlineManager } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Game, GameSort, PageResult } from '@psstore/shared'
import SearchResults from '../components/SearchResults'
import { SortContext } from '../modules/sortContext'
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

const game = (id: string, name: string, date = '', price = '€9,99'): Game => ({
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

  describe('sorted', () => {
    const dateDesc = { field: 'date', direction: 'desc' } as const
    const nameAsc = { field: 'name', direction: 'asc' } as const

    const renderSorted = (
      sort: typeof dateDesc | typeof nameAsc,
      term = 'alp',
    ) =>
      renderWithRouter(
        <SortContext.Provider value={sort}>
          <SearchResults term={term} />
        </SortContext.Provider>,
      )

    const names = (): (string | null)[] =>
      Array.from(document.querySelectorAll('.game-card--name')).map(
        (element) => element.textContent,
      )

    const twoPages = () =>
      stubFetch((url) =>
        url.searchParams.get('offset') === '0'
          ? respond(
              page(
                [
                  game('1', 'Charlie', '2026-01-01T00:00:00Z'),
                  game('2', 'Nodate'),
                ],
                50,
              ),
            )
          : respond(
              page(
                [
                  game('1', 'Charlie', '2026-01-01T00:00:00Z'),
                  game('3', 'Alpha', '2026-03-01T00:00:00Z'),
                  game('4', 'Bravo', '2026-02-01T00:00:00Z'),
                ],
                null,
              ),
            ),
      )

    it('orders by date, newest first, with an unknown date last, after every page', async () => {
      const fetchMock = twoPages()
      const { container } = await renderSorted(dateDesc)

      expect(container.querySelector('.spinner')).not.toBeNull()
      await waitFor(() => {
        expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Nodate'])
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(container.querySelector('.spinner')).toBeNull()
      expect(screen.getByRole('status')).toHaveTextContent('4 PS5 games found')
    })

    it('shows no card before the last page arrives', async () => {
      let release: (value: Response) => void = () => undefined
      let requested = false
      stubFetch((url) =>
        url.searchParams.get('offset') === '0'
          ? respond(page([game('1', 'Charlie')], 50))
          : (() => {
              requested = true
              return new Promise<Response>((resolve) => {
                release = resolve
              })
            })(),
      )
      const { container } = await renderSorted(dateDesc)

      await waitFor(() => {
        expect(requested).toBe(true)
      })
      await waitFor(() => {
        expect(container.querySelector('.spinner')).not.toBeNull()
      })
      expect(screen.queryByText('Charlie')).toBeNull()

      release(respond(page([game('2', 'Alpha')], null)))
      expect(await screen.findByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Charlie')).toBeInTheDocument()
    })

    it('re-sorts on a sort change without a new fetch', async () => {
      const fetchMock = twoPages()
      const Harness = () => {
        const [sort, setSort] = useState<GameSort>(dateDesc)
        return (
          <SortContext.Provider value={sort}>
            <button
              type="button"
              onClick={() => {
                setSort(nameAsc)
              }}
            >
              Name
            </button>
            <SearchResults term="alp" />
          </SortContext.Provider>
        )
      }
      await renderWithRouter(<Harness />)
      await waitFor(() => {
        expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Nodate'])
      })

      fireEvent.click(screen.getByRole('button', { name: 'Name' }))

      await waitFor(() => {
        expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Nodate'])
      })
      fireEvent.click(screen.getByRole('button', { name: 'Name' }))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('shows the error and Retry with no half-sorted grid, then resumes', async () => {
      let secondCalls = 0
      stubFetch((url) => {
        if (url.searchParams.get('offset') === '0') {
          return respond(page([game('1', 'Charlie')], 50))
        }
        secondCalls += 1
        return secondCalls === 1
          ? new Response('', { status: 502 })
          : respond(page([game('2', 'Alpha')], null))
      })
      await renderSorted(nameAsc)

      expect(
        await screen.findByText('Could not load more results'),
      ).toBeInTheDocument()
      expect(screen.queryByText('Charlie')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(names()).toEqual(['Alpha', 'Charlie'])
      })
    })

    it('shows Offline while paging, with no card', async () => {
      stubFetch((url) => {
        if (url.searchParams.get('offset') === '0') {
          queueMicrotask(() => {
            onlineManager.setOnline(false)
          })
          return respond(page([game('1', 'Charlie')], 50))
        }
        return respond(page([game('2', 'Alpha')], null))
      })
      await renderSorted(nameAsc)

      expect(
        await screen.findByText(
          'You are offline. Games load when the connection returns.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText('Charlie')).toBeNull()
    })

    it('merges no page of a stale term after the term changes mid-load', async () => {
      let releaseOld: (value: Response) => void = () => undefined
      stubFetch((url) => {
        const q = url.searchParams.get('q')
        if (q === 'old') {
          return url.searchParams.get('offset') === '0'
            ? respond(page([game('1', 'OldFirst')], 50))
            : new Promise<Response>((resolve) => {
                releaseOld = resolve
              })
        }
        return respond(page([game('9', 'NewOnly')], null))
      })
      const Harness = () => {
        const [term, setTerm] = useState('old')
        return (
          <SortContext.Provider value={dateDesc}>
            <button
              type="button"
              onClick={() => {
                setTerm('new')
              }}
            >
              Change
            </button>
            <SearchResults term={term} />
          </SortContext.Provider>
        )
      }
      await renderWithRouter(<Harness />)
      await waitFor(() => {
        expect(document.querySelector('.spinner')).not.toBeNull()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Change' }))
      await waitFor(() => {
        expect(names()).toEqual(['NewOnly'])
      })
      releaseOld(respond(page([game('2', 'OldLate')], null)))

      await waitFor(() => {
        expect(names()).toEqual(['NewOnly'])
      })
      expect(screen.queryByText('OldFirst')).toBeNull()
      expect(screen.queryByText('OldLate')).toBeNull()
    })

    it('removes a game repeated across pages before it sorts', async () => {
      twoPages()
      await renderSorted(nameAsc)

      await waitFor(() => {
        expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Nodate'])
      })
    })
  })
})
