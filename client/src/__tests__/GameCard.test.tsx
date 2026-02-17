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

  it('renders title, genres, and price', () => {
    render(
      <MemoryRouter>
        <GameCard game={game} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Test Game')).toBeInTheDocument()
    expect(screen.getByText('Action, Adventure')).toBeInTheDocument()
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
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

  it('shows Unknown genre when genres are empty', () => {
    render(
      <MemoryRouter>
        <GameCard game={{ ...game, genres: [] }} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Unknown genre')).toBeInTheDocument()
  })
})
