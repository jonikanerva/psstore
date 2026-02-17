import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchConceptsByFeature = vi.fn()
const fetchProductReleaseDate = vi.fn()
const fetchProductDetail = vi.fn()

vi.mock('../sony/sonyClient.js', () => ({
  fetchConceptsByFeature,
  fetchProductReleaseDate,
  fetchProductDetail,
}))

let conceptCounter = 0
const makeConcept = (name: string, overrides: Record<string, unknown> = {}) => {
  conceptCounter += 1
  const num = String(conceptCounter).padStart(5, '0')
  return {
    id: `${conceptCounter}`,
    name,
    media: [{ type: 'IMAGE', role: 'MASTER', url: `https://img/${name}` }],
    price: {
      basePrice: '€29.95',
      discountedPrice: '€29.95',
      discountText: null,
      serviceBranding: ['NONE'],
      upsellServiceBranding: ['NONE'],
    },
    products: [{ id: `EP0001-PPSA${num}_00-${name.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(16, '0').slice(0, 16)}` }],
    ...overrides,
  }
}

const PAST_DATE = '2025-01-01T00:00:00Z'
const FUTURE_DATE = '2099-01-01T00:00:00Z'

beforeEach(() => {
  conceptCounter = 0
  vi.resetModules()
  fetchConceptsByFeature.mockReset()
  fetchProductReleaseDate.mockReset()
  fetchProductDetail.mockReset()
  fetchProductDetail.mockImplementation(async () => ({
    releaseDate: PAST_DATE,
    genres: [],
    description: '',
  }))

  fetchConceptsByFeature.mockImplementation(async (feature: string) => {
    if (feature === 'new') return [makeConcept('alpha'), makeConcept('bravo', {
      price: {
        basePrice: '€29.95',
        discountedPrice: '€19.95',
        discountText: 'sale',
        serviceBranding: ['PS_PLUS'],
        upsellServiceBranding: ['PS_PLUS'],
      },
    })]
    if (feature === 'upcoming') return [makeConcept('future')]
    if (feature === 'discounted') return [makeConcept('deal')]
    if (feature === 'plus') return [makeConcept('plusgame')]
    return []
  })
})

describe('gamesService', () => {
  it('returns non-empty sets for all feature tabs', async () => {
    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('FUTURE') ? FUTURE_DATE : PAST_DATE,
      genres: [],
      description: '',
    }))

    const svc = await import('../services/gamesService.js')

    expect((await svc.getNewGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getUpcomingGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getDiscountedGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getPlusGames()).games.length).toBeGreaterThan(0)
  })

  it('enriches games with release dates from fetchProductDetail', async () => {
    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: '2024-06-15T00:00:00Z',
      genres: [],
      description: '',
    }))

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()

    expect(games.length).toBeGreaterThan(0)
    expect(games.every((g) => g.date === '2024-06-15T00:00:00Z')).toBe(true)
  })

  it('filters out games without valid release dates', async () => {
    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('ALPHA') ? PAST_DATE : undefined,
      genres: [],
      description: '',
    }))

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()

    expect(games.every((g) => Boolean(g.date))).toBe(true)
    expect(games.some((g) => g.name === 'alpha')).toBe(true)
    expect(games.some((g) => g.name === 'bravo')).toBe(false)
  })

  it('filters out games with invalid product IDs (concept ID fallback)', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature !== 'new') return []
      return [
        makeConcept('valid-game'),
        { id: '12345', name: 'concept-only', media: [], price: {}, products: [] },
        { id: '67890', name: 'no-products', media: [], price: {} },
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()

    expect(games.every((g) => g.name !== 'concept-only')).toBe(true)
    expect(games.every((g) => g.name !== 'no-products')).toBe(true)
  })

  it('resolves game detail for upcoming ids not present in base feed', async () => {
    const upcomingConcept = makeConcept('upcoming-only')
    const upcomingProductId = upcomingConcept.products[0].id

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId === upcomingProductId ? FUTURE_DATE : PAST_DATE,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') return [makeConcept('base-game')]
      if (feature === 'upcoming') return [upcomingConcept]
      return []
    })

    const svc = await import('../services/gamesService.js')
    const { games: upcoming } = await svc.getUpcomingGames()

    expect(upcoming.some((game) => game.id === upcomingProductId)).toBe(true)
    await expect(svc.getGameById(upcomingProductId)).resolves.toMatchObject({
      id: upcomingProductId,
      name: 'upcoming-only',
    })
  })

  it('returns empty result when no concepts exist for a feature', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? [makeConcept('base')] : [],
    )

    const svc = await import('../services/gamesService.js')

    const { games: upcoming } = await svc.getUpcomingGames()
    const { games: discounted } = await svc.getDiscountedGames()
    const { games: plus } = await svc.getPlusGames()

    expect(upcoming.length).toBe(0)
    expect(discounted.length).toBe(0)
    expect(plus.length).toBe(0)
  })

  it('new excludes future games, upcoming excludes released games', async () => {
    const concepts = [
      makeConcept('released'),
      makeConcept('future'),
    ]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('RELEASED') ? '2024-01-01T00:00:00Z' : FUTURE_DATE,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') return concepts
      if (feature === 'upcoming') return concepts
      return []
    })

    const svc = await import('../services/gamesService.js')

    const { games: newGames } = await svc.getNewGames()
    expect(newGames.map((g) => g.name)).toEqual(['released'])

    const { games: upcoming } = await svc.getUpcomingGames()
    expect(upcoming.map((g) => g.name)).toEqual(['future'])
  })

  it('new/discounted/plus sort by date descending', async () => {
    const concepts = [
      makeConcept('old'),
      makeConcept('recent'),
      makeConcept('mid'),
    ]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('OLD') ? '2023-01-01T00:00:00Z'
        : productId.includes('RECENT') ? '2025-06-01T00:00:00Z'
        : '2024-06-01T00:00:00Z',
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async () => concepts)

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()
    expect(games.map((g) => g.name)).toEqual(['recent', 'mid', 'old'])
  })

  it('upcoming sorts by date ascending', async () => {
    const concepts = [
      makeConcept('later'),
      makeConcept('sooner'),
    ]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('LATER') ? '2099-06-01T00:00:00Z' : '2099-01-01T00:00:00Z',
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? concepts : [makeConcept('base')],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getUpcomingGames()
    expect(games.map((g) => g.name)).toEqual(['sooner', 'later'])
  })

  it('maps discount fields from concept price', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature !== 'new') return []
      return [
        makeConcept('full-price'),
        makeConcept('on-sale', {
          price: {
            basePrice: '€59,99',
            discountedPrice: '€39,99',
            discountText: '-33%',
            serviceBranding: ['NONE'],
            upsellServiceBranding: ['NONE'],
          },
        }),
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()

    const fullPrice = games.find((g) => g.name === 'full-price')
    expect(fullPrice?.originalPrice).toBe('')
    expect(fullPrice?.discountText).toBe('')

    const onSale = games.find((g) => g.name === 'on-sale')
    expect(onSale?.originalPrice).toBe('€59,99')
    expect(onSale?.discountText).toBe('-33%')
    expect(onSale?.price).toBe('€39,99')
  })

  it('getNewGames respects offset and size', async () => {
    const concepts = Array.from({ length: 10 }, (_, i) =>
      makeConcept(`game-${i}`),
    )

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const page = await svc.getNewGames(0, 3)

    expect(page.games).toHaveLength(3)
    expect(page.totalCount).toBe(10)
    expect(page.nextOffset).toBe(3)
  })

  it('getNewGames returns null nextOffset on last page', async () => {
    const svc = await import('../services/gamesService.js')
    const page = await svc.getNewGames(0, 200)

    expect(page.nextOffset).toBeNull()
  })
})
