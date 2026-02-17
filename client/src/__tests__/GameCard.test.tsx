import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Game } from '@psstore/shared'
import GameCard from '../components/GameCard'

const game: Game = {
  id: 'EP0001-PPSA01234_00-TESTGAME00000001',
  name: 'Test Game',
  date: '2025-06-15T00:00:00Z',
  url: 'https://example.com/cover.png',
  price: '69,99 €',
  originalPrice: '',
  discountText: '',
  discountDate: '1975-01-01T00:00:00Z',
  screenshots: [],
  videos: [],
  genres: ['Action', 'Adventure'],
  description: 'A test game',
  studio: 'Test Studio',
  preOrder: false,
}

describe('GameCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders title, date, and price', () => {
    render(
      <MemoryRouter>
        <GameCard game={game} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Test Game')).toBeInTheDocument()
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
    expect(screen.getByText(/15 Jun 2025|Jun 15, 2025/)).toBeInTheDocument()
  })

  it('links to the game detail page', () => {
    render(
      <MemoryRouter>
        <GameCard game={game} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: /Test Game/ })
    expect(link).toHaveAttribute('href', `/g/${game.id}`)
  })

  it('shows original price with strikethrough when discounted', () => {
    render(
      <MemoryRouter>
        <GameCard
          game={{
            ...game,
            price: '€39,99',
            originalPrice: '€59,99',
            discountText: '-33%',
          }}
        />
      </MemoryRouter>,
    )

    const original = screen.getByText('€59,99')
    expect(original.tagName).toBe('S')
    expect(screen.getByText('€39,99')).toBeInTheDocument()
  })

  it('shows single price when not discounted', () => {
    render(
      <MemoryRouter>
        <GameCard game={game} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('deletion')).not.toBeInTheDocument()
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
  })
})
