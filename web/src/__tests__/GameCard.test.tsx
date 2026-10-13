import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { Settings } from 'luxon'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Game } from '@psstore/shared'
import GameCard from '../components/GameCard'
import { readPdpOrigin } from '../modules/pdpOrigin'
import { renderRoutes, renderWithRouter } from './testRouter'

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
  plusOffer: null,
  idKind: 'product',
}

describe('GameCard', () => {
  beforeEach(() => {
    Settings.defaultZone = 'UTC'
  })

  afterEach(() => {
    Settings.defaultZone = 'system'
    cleanup()
  })

  it('renders title, date, and price', async () => {
    await renderWithRouter(<GameCard game={game} />)

    expect(screen.getByText('Test Game')).toBeInTheDocument()
    expect(screen.getByText('69,99 €')).toBeInTheDocument()
    expect(screen.getByText('15 Jun 2025')).toBeInTheDocument()
  })

  it('links to the game detail page', async () => {
    await renderWithRouter(<GameCard game={game} />)

    const link = screen.getByRole('link', { name: /Test Game/ })
    expect(link).toHaveAttribute('href', `/g/${game.id}`)
  })

  it('passes the tab it was opened from to the game page', async () => {
    const router = await renderRoutes(
      {
        '/discounted': () => <GameCard game={game} />,
        '/g/$gameId': () => null,
      },
      ['/discounted'],
    )
    act(() => {
      screen.getByRole('link', { name: /Test Game/ }).click()
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/g/${game.id}`)
    })
    expect(readPdpOrigin(router.state.location.state)).toBe('/discounted')
  })

  it('passes no origin from a path that is not a tab', async () => {
    const router = await renderRoutes(
      {
        '/other': () => <GameCard game={game} />,
        '/g/$gameId': () => null,
      },
      ['/other'],
    )
    act(() => {
      screen.getByRole('link', { name: /Test Game/ }).click()
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/g/${game.id}`)
    })
    expect(readPdpOrigin(router.state.location.state)).toBeUndefined()
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
      <GameCard game={{ ...game, plusUpsellText: 'Save 10%' }} />,
    )

    expect(screen.getByText('PS+ Save 10%')).toBeInTheDocument()
  })

  it('labels an unreleased game as Pre-order when the view asks for it', async () => {
    await renderWithRouter(
      <GameCard game={{ ...game, preOrder: true }} showPreOrder />,
    )

    const label = screen.getByText('Pre-order')
    expect(label).toHaveClass('game-card--preorder')
    expect(label.closest('.game-card--date')?.textContent).toBe(
      '15 Jun 2025 Pre-order',
    )
  })

  it('shows no Pre-order label for a released game', async () => {
    await renderWithRouter(<GameCard game={game} showPreOrder />)

    expect(screen.queryByText('Pre-order')).not.toBeInTheDocument()
  })

  it('shows no Pre-order label when the view does not ask for it', async () => {
    await renderWithRouter(<GameCard game={{ ...game, preOrder: true }} />)

    expect(screen.queryByText('Pre-order')).not.toBeInTheDocument()
  })

  it('omits the PS+ indicator when plusUpsellText is null', async () => {
    await renderWithRouter(<GameCard game={game} />)

    expect(screen.queryByText(/^PS\+/)).not.toBeInTheDocument()
  })

  it('renders PS+ Included for an included offer without a Sony label', async () => {
    // A wishlist card has the PS Plus offer and no label. The price sort
    // reads an included game as 0 €, so the card shows why.
    await renderWithRouter(
      <GameCard game={{ ...game, plusOffer: { kind: 'included' } }} />,
    )

    expect(screen.getByText('PS+ Included')).toBeInTheDocument()
  })

  it('prefers an included offer over the Sony label', async () => {
    // A Premium Classic has the label "Premium" and an included offer. It
    // sorts as 0 €, so the card must not look like a Premium trial.
    await renderWithRouter(
      <GameCard
        game={{
          ...game,
          plusUpsellText: 'Premium',
          plusOffer: { kind: 'included' },
        }}
      />,
    )

    expect(screen.getByText('PS+ Included')).toBeInTheDocument()
    expect(screen.queryByText('PS+ Premium')).not.toBeInTheDocument()
  })

  it('keeps the Sony label next to a PS Plus price offer', async () => {
    await renderWithRouter(
      <GameCard
        game={{
          ...game,
          plusUpsellText: 'Save 10%',
          plusOffer: { kind: 'price', price: '€26,99' },
        }}
      />,
    )

    expect(screen.getByText('PS+ Save 10%')).toBeInTheDocument()
  })

  it('omits the PS+ indicator for a PS Plus price offer without a label', async () => {
    await renderWithRouter(
      <GameCard
        game={{ ...game, plusOffer: { kind: 'price', price: '€29,99' } }}
      />,
    )

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

  it('opens the internal game page for a concept card when asked', async () => {
    await renderWithRouter(
      <GameCard
        internalLink
        game={{ ...game, id: '10018729', idKind: 'concept' }}
      />,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/g/10018729')
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

  it('renders the date as day, abbreviated month, year (en-GB)', async () => {
    await renderWithRouter(
      <GameCard game={{ ...game, date: '2025-12-03T10:00:00Z' }} />,
    )

    expect(screen.getByText('3 Dec 2025')).toBeInTheDocument()
  })

  it('keeps a date one second before midnight UTC on the same day', async () => {
    await renderWithRouter(
      <GameCard game={{ ...game, date: '2025-06-15T23:59:59Z' }} />,
    )

    expect(screen.getByText('15 Jun 2025')).toBeInTheDocument()
  })

  it('converts the instant to the viewer zone (next day in Auckland)', async () => {
    Settings.defaultZone = 'Pacific/Auckland'
    await renderWithRouter(
      <GameCard game={{ ...game, date: '2025-06-15T13:00:00Z' }} />,
    )

    expect(screen.getByText('16 Jun 2025')).toBeInTheDocument()
  })

  it('renders no date text for an empty date', async () => {
    await renderWithRouter(<GameCard game={{ ...game, date: '' }} />)

    expect(screen.queryByText(/\d{4}/)).not.toBeInTheDocument()
  })
})
