import { onlineManager, QueryClient } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { Settings } from 'luxon'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '@psstore/shared'
import GameDetailsPage from '../components/GameDetailsPage'
import { renderWithRouter } from './testRouter'

const baseGame: Game = {
  id: 'EP0001-PPSA01234_00-TESTGAME00000001',
  name: 'Detail Game',
  date: '2025-06-15T00:00:00Z',
  url: 'https://example.com/cover.png',
  price: '49,99 €',
  originalPrice: '',
  discountText: '',
  discountDate: '1975-01-01T00:00:00Z',
  screenshots: ['https://example.com/ss1.png'],
  videos: ['https://example.com/vid1.mp4'],
  genres: ['RPG'],
  description: '<p>A great game</p>',
  studio: 'RPG Studio',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind: 'product',
}

vi.mock('../modules/psnStore', () => ({
  fetchGame: vi.fn(),
  metacriticLink: (name: string) =>
    `https://www.metacritic.com/search/${encodeURIComponent(name)}/`,
}))

describe('GameDetailsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Settings.defaultZone = 'UTC'
  })

  afterEach(() => {
    Settings.defaultZone = 'system'
    cleanup()
    onlineManager.setOnline(true)
  })

  it('renders game details when loaded', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.getByText(/49,99 €/)).toBeInTheDocument()
    expect(screen.getByText(/RPG Studio/)).toBeInTheDocument()
  })

  it('renders description section only when description exists', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Description')).toBeInTheDocument()
    })
  })

  it('hides description section when description is empty', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({ ...baseGame, description: '' })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.queryByText('Description')).not.toBeInTheDocument()
  })

  it('renders media section only when screenshots or videos exist', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({
      ...baseGame,
      screenshots: [],
      videos: [],
    })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.queryByText('Media')).not.toBeInTheDocument()
  })

  it('shows error state on fetch failure', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockRejectedValue(new Error('not found'))

    await renderWithRouter(<GameDetailsPage gameId="bad-id" />)

    await waitFor(() => {
      expect(screen.getByText('Game not found')).toBeInTheDocument()
    })
  })

  it('renders a PS Plus row with Sony upsellText verbatim when set', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({
      ...baseGame,
      plusUpsellText: 'Save 10%',
    })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('PS Plus')).toBeInTheDocument()
    })

    expect(screen.getByText('Save 10%')).toBeInTheDocument()
  })

  it('omits the PS Plus row when plusUpsellText is null', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.queryByText('PS Plus')).not.toBeInTheDocument()
  })

  it('shows the Standard and PS Plus prices as labelled values', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({
      ...baseGame,
      plusOffer: { kind: 'price', price: '€44,95' },
    })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    const standard = await screen.findByText('Standard')
    expect(standard.nextElementSibling).toHaveTextContent('49,99 €')
    const plus = screen.getByText('PS Plus')
    expect(plus.nextElementSibling).toHaveTextContent('€44,95')
  })

  it('shows Included under PS Plus for a subscription game', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({
      ...baseGame,
      plusOffer: { kind: 'included' },
    })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    const plus = await screen.findByText('PS Plus')
    expect(plus.nextElementSibling).toHaveTextContent('Included')
  })

  it('shows only the standard price when there is no Plus offer', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    expect(await screen.findByText('Standard')).toBeInTheDocument()
    expect(screen.queryByText('PS Plus')).not.toBeInTheDocument()
  })

  it('shows the upsell text only under the PS Plus label when the offer is null', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({
      ...baseGame,
      plusOffer: null,
      plusUpsellText: 'Save 10%',
    })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    const plus = await screen.findByText('PS Plus')
    expect(plus.nextElementSibling).toHaveTextContent('Save 10%')
    const standard = screen.getByText('Standard')
    expect(standard.nextElementSibling).not.toHaveTextContent('Save 10%')
  })

  it('treats a missing plusOffer key from an older cached payload as absent', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    const legacy = { ...baseGame }
    Reflect.deleteProperty(legacy, 'plusOffer')
    vi.mocked(fetchGame).mockResolvedValue(legacy)

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    expect(await screen.findByText('Standard')).toBeInTheDocument()
    expect(screen.queryByText('PS Plus')).not.toBeInTheDocument()
  })

  it('renders the release date as day, abbreviated month, year (en-GB)', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({
      ...baseGame,
      date: '2025-06-15T23:59:59Z',
    })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('15 Jun 2025')).toBeInTheDocument()
    })
  })

  it('renders Unknown for an empty release date', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({ ...baseGame, date: '' })

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Unknown')).toBeInTheDocument()
    })
  })

  it('links to the English Finnish-store product page', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    const link = document.querySelector(
      'a[href^="https://store.playstation.com"]',
    )
    expect(link).toHaveAttribute(
      'href',
      `https://store.playstation.com/en-fi/product/${baseGame.id}`,
    )
  })

  it('shows the offline state instead of the spinner while the fetch is paused', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    onlineManager.setOnline(false)

    const { container } = await renderWithRouter(
      <GameDetailsPage gameId={baseGame.id} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'You are offline. Games load when the connection returns.',
    )
    expect(container.querySelector('.spinner')).toBeNull()
    expect(fetchGame).not.toHaveBeenCalled()
  })

  it('loads the game when the connection returns', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)
    onlineManager.setOnline(false)
    await renderWithRouter(<GameDetailsPage gameId={baseGame.id} />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      onlineManager.setOnline(true)
    })

    expect(await screen.findByText('Detail Game')).toBeInTheDocument()
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument()
  })

  it('shows the skeleton, not the offline state, while an online fetch is pending', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockReturnValue(new Promise(() => undefined))

    const { container } = await renderWithRouter(
      <GameDetailsPage gameId={baseGame.id} />,
    )

    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument()
  })

  it('paints a game from the list cache before its own request finishes', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockReturnValue(new Promise(() => undefined))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    queryClient.setQueryData(['games', 'new'], {
      pages: [
        {
          games: [{ ...baseGame, description: '', genres: [], studio: '' }],
          totalCount: 1,
          nextOffset: null,
        },
      ],
      pageParams: [0],
    })

    await renderWithRouter(
      <GameDetailsPage gameId={baseGame.id} />,
      queryClient,
    )

    expect(screen.getByText('Detail Game')).toBeInTheDocument()
    expect(screen.getByText(/49,99 €/)).toBeInTheDocument()
    expect(screen.queryByText('Description')).not.toBeInTheDocument()
  })
})
