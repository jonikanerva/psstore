import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Game } from '@psstore/shared'
import GameCard from '../components/GameCard'
import { renderWithRouter } from './testRouter'

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
  plusUpsellText: null,
  idKind: 'product',
}

describe('GameCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders title, date, and price', async () => {
    await renderWithRouter(<GameCard game={game} />)

    expect(screen.getByText('Test Game')).toBeInTheDocument()
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
    expect(screen.getByText(/15 Jun 2025|Jun 15, 2025/)).toBeInTheDocument()
  })

  it('links to the game detail page', async () => {
    await renderWithRouter(<GameCard game={game} />)

    const link = screen.getByRole('link', { name: /Test Game/ })
    expect(link).toHaveAttribute('href', `/g/${game.id}`)
  })

  it('shows original price with strikethrough when discounted', async () => {
    await renderWithRouter(
      <GameCard
        game={{
          ...game,
          price: '€39,99',
          originalPrice: '€59,99',
          discountText: '-33%',
        }}
      />,
    )

    const original = screen.getByText('€59,99')
    expect(original.tagName).toBe('S')
    expect(screen.getByText('€39,99')).toBeInTheDocument()
  })

  it('shows single price when not discounted', async () => {
    await renderWithRouter(<GameCard game={game} />)

    expect(screen.queryByRole('deletion')).not.toBeInTheDocument()
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
  })

  it('renders the PS+ indicator with Sony upsellText verbatim when set', async () => {
    await renderWithRouter(
      <GameCard game={{ ...game, plusUpsellText: 'Säästä 10 %' }} />,
    )

    expect(screen.getByText('PS+ Säästä 10 %')).toBeInTheDocument()
  })

  it('omits the PS+ indicator when plusUpsellText is null', async () => {
    await renderWithRouter(<GameCard game={game} />)

    expect(screen.queryByText(/^PS\+/)).not.toBeInTheDocument()
  })

  it('renders an internal PDP link and normal price for a product card', async () => {
    await renderWithRouter(<GameCard game={{ ...game, idKind: 'product' }} />)

    const link = screen.getByRole('link', { name: /Test Game/ })
    expect(link).toHaveAttribute('href', `/g/${game.id}`)
    expect(link).not.toHaveAttribute('target')
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('links a concept card out to Sony and shows "Unknown" for the price', async () => {
    await renderWithRouter(
      <GameCard
        game={{
          ...game,
          id: '10018729',
          name: 'RunNGun',
          price: '',
          date: '',
          idKind: 'concept',
        }}
      />,
    )

    const link = screen.getByRole('link', {
      name: 'RunNGun on PlayStation Store',
    })
    expect(link).toHaveAttribute(
      'href',
      'https://store.playstation.com/en-fi/concept/10018729',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})
