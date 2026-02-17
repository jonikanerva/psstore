import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '@psstore/shared'
import GameDetailsPage from '../components/GameDetailsPage'

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
}

vi.mock('../modules/psnStore', () => ({
  fetchGame: vi.fn(),
  metacriticLink: (name: string) => `https://www.metacritic.com/search/${encodeURIComponent(name)}/`,
}))

describe('GameDetailsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders game details when loaded', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    render(
      <MemoryRouter>
        <GameDetailsPage gameId={baseGame.id} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.getByText(/49,99 €/)).toBeInTheDocument()
    expect(screen.getByText(/RPG Studio/)).toBeInTheDocument()
  })

  it('renders description section only when description exists', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue(baseGame)

    render(
      <MemoryRouter>
        <GameDetailsPage gameId={baseGame.id} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Description')).toBeInTheDocument()
    })
  })

  it('hides description section when description is empty', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({ ...baseGame, description: '' })

    render(
      <MemoryRouter>
        <GameDetailsPage gameId={baseGame.id} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.queryByText('Description')).not.toBeInTheDocument()
  })

  it('renders media section only when screenshots or videos exist', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockResolvedValue({ ...baseGame, screenshots: [], videos: [] })

    render(
      <MemoryRouter>
        <GameDetailsPage gameId={baseGame.id} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Detail Game')).toBeInTheDocument()
    })

    expect(screen.queryByText('Media')).not.toBeInTheDocument()
  })

  it('shows error state on fetch failure', async () => {
    const { fetchGame } = await import('../modules/psnStore')
    vi.mocked(fetchGame).mockRejectedValue(new Error('not found'))

    render(
      <MemoryRouter>
        <GameDetailsPage gameId="bad-id" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Game not found')).toBeInTheDocument()
    })
  })
})
