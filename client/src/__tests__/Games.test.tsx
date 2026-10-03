import { QueryClient, onlineManager } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Game, PageResult } from '@psstore/shared'
import Games from '../components/Games'
import { SearchContext } from '../modules/searchContext'
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

const game = (id: string, name: string): Game => ({
  id,
  name,
  date: '2025-09-18T17:00:00Z',
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

const page = (games: Game[]): PageResult => ({
  games,
  totalCount: games.length,
  nextOffset: null,
})

const MonthlyWithSearch = ({
  fetch,
  query,
}: {
  fetch: () => Promise<PageResult>
  query: string
}) => {
  const [value] = useState(query)
  return (
    <SearchContext.Provider value={value}>
      <Games
        feature="monthly"
        fetch={fetch}
        emptyMessage="No PS Plus monthly games right now"
      />
    </SearchContext.Provider>
  )
}

describe('Games feature monthly', () => {
  afterEach(() => {
    cleanup()
    onlineManager.setOnline(true)
  })

  it('renders the cards without a price', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(page([game('EP1-PPSA1_00-A', 'Wobbly Life')]))
    await renderWithRouter(<MonthlyWithSearch fetch={fetch} query="" />)

    expect(await screen.findByText('Wobbly Life')).toBeInTheDocument()
    expect(screen.queryByText('-')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(0, 60)
  })

  it('filters by the search text', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        page([
          game('EP1-PPSA1_00-A', 'Wobbly Life'),
          game('EP1-PPSA2_00-B', 'Fallout 76'),
        ]),
      )
    await renderWithRouter(<MonthlyWithSearch fetch={fetch} query="wobb" />)

    expect(await screen.findByText('Wobbly Life')).toBeInTheDocument()
    expect(screen.queryByText('Fallout 76')).not.toBeInTheDocument()
  })

  it('shows the monthly empty text for an empty list', async () => {
    const fetch = vi.fn().mockResolvedValue(page([]))
    await renderWithRouter(<MonthlyWithSearch fetch={fetch} query="" />)

    expect(
      await screen.findByText('No PS Plus monthly games right now'),
    ).toBeInTheDocument()
  })

  it('shows the error state when the request fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('502'))
    await renderWithRouter(<MonthlyWithSearch fetch={fetch} query="" />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load games')).toBeInTheDocument()
    })
  })

  it('keeps showing the price on the other views', async () => {
    const fetch = vi.fn().mockResolvedValue(page([game('EP1-PPSA1_00-A', 'X')]))
    await renderWithRouter(<Games feature="new" fetch={fetch} />)

    expect(await screen.findByText('-')).toBeInTheDocument()
  })

  it('shows the offline state instead of the spinner while the first fetch is paused', async () => {
    onlineManager.setOnline(false)
    const fetch = vi.fn().mockResolvedValue(page([game('EP1-PPSA1_00-A', 'X')]))
    const { container } = await renderWithRouter(
      <Games feature="new" fetch={fetch} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'You are offline. Games load when the connection returns.',
    )
    expect(container.querySelector('.spinner')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads the games when the connection returns', async () => {
    onlineManager.setOnline(false)
    const fetch = vi
      .fn()
      .mockResolvedValue(page([game('EP1-PPSA1_00-A', 'Wobbly Life')]))
    await renderWithRouter(<Games feature="new" fetch={fetch} />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      onlineManager.setOnline(true)
    })

    expect(await screen.findByText('Wobbly Life')).toBeInTheDocument()
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument()
  })

  it('shows the spinner, not the offline state, while an online fetch is pending', async () => {
    const fetch = vi.fn().mockReturnValue(new Promise(() => undefined))
    const { container } = await renderWithRouter(
      <Games feature="new" fetch={fetch} />,
    )

    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument()
  })

  it('stays silent when cached games exist and a refetch is paused', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    client.setQueryData(['games', 'new'], {
      pages: [page([game('EP1-PPSA1_00-A', 'Wobbly Life')])],
      pageParams: [0],
    })
    onlineManager.setOnline(false)
    const fetch = vi.fn().mockResolvedValue(page([]))
    await renderWithRouter(<Games feature="new" fetch={fetch} />, client)

    expect(await screen.findByText('Wobbly Life')).toBeInTheDocument()
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument()
  })
})

describe('Games loading indicator', () => {
  afterEach(() => {
    cleanup()
  })

  it('announces loading until the first page resolves', async () => {
    let resolve: (value: PageResult) => void = () => undefined
    const fetch = vi.fn(
      () =>
        new Promise<PageResult>((r) => {
          resolve = r
        }),
    )
    await renderWithRouter(<Games feature="new" fetch={fetch} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    await act(async () => {
      resolve(page([game('EP1-PPSA1_00-A', 'Wobbly Life')]))
    })

    expect(await screen.findByText('Wobbly Life')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the indicator while the next page loads and keeps the cards', async () => {
    let intersect: IntersectionObserverCallback = () => undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback
        }
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
    const fetch = vi
      .fn<(offset: number, size: number) => Promise<PageResult>>()
      .mockResolvedValueOnce({
        games: [game('EP1-PPSA1_00-A', 'Wobbly Life')],
        totalCount: 2,
        nextOffset: 60,
      })
      .mockReturnValueOnce(new Promise<PageResult>(() => undefined))
    await renderWithRouter(<Games feature="new" fetch={fetch} />)
    expect(await screen.findByText('Wobbly Life')).toBeInTheDocument()

    await act(async () => {
      intersect(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
    expect(screen.getByText('Wobbly Life')).toBeInTheDocument()
  })
})
