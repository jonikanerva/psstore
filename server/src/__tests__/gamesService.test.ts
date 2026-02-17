import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchConceptsByFeature = vi.fn()
const fetchProductReleaseDate = vi.fn()
const fetchProductDetail = vi.fn()

vi.mock('../sony/sonyClient.js', () => ({
  fetchConceptsByFeature,
  fetchProductReleaseDate,
  fetchProductDetail,
}))

const makeConcept = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `${name}-concept`,
  name,
  media: [{ type: 'IMAGE', role: 'MASTER', url: `https://img/${name}` }],
  price: {
    basePrice: '€29.95',
    discountedPrice: '€29.95',
    discountText: null,
    serviceBranding: ['NONE'],
    upsellServiceBranding: ['NONE'],
  },
  products: [{ id: `${name}-product` }],
  ...overrides,
})

const baseConcepts = [
  makeConcept('alpha'),
  makeConcept('bravo', {
    price: {
      basePrice: '€29.95',
      discountedPrice: '€19.95',
      discountText: 'sale',
      serviceBranding: ['PS_PLUS'],
      upsellServiceBranding: ['PS_PLUS'],
    },
  }),
]

beforeEach(() => {
  vi.resetModules()
  fetchConceptsByFeature.mockReset()
  fetchProductReleaseDate.mockReset()
  fetchProductDetail.mockReset()
  fetchProductDetail.mockImplementation(async () => ({
    releaseDate: '2025-01-01T00:00:00Z',
    genres: [],
    description: '',
  }))

  fetchConceptsByFeature.mockImplementation(async (feature: string) => {
    if (feature === 'new') return baseConcepts
    if (feature === 'upcoming') return [makeConcept('future')]
    if (feature === 'discounted') return [baseConcepts[1]]
    if (feature === 'plus') return [baseConcepts[1]]
    return []
  })
})

describe('gamesService', () => {
  it('returns non-empty sets for all feature tabs', async () => {
    const svc = await import('../services/gamesService.js')

    expect((await svc.getNewGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getUpcomingGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getDiscountedGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getPlusGames()).games.length).toBeGreaterThan(0)
  })

  it('resolves game detail for upcoming ids not present in base feed', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') return baseConcepts
      if (feature === 'upcoming') {
        return [
          makeConcept('upcoming-only', {
            products: [{ id: 'upcoming-only-product' }],
          }),
        ]
      }
      return []
    })

    const svc = await import('../services/gamesService.js')
    const { games: upcoming } = await svc.getUpcomingGames()

    expect(upcoming.some((game) => game.id === 'upcoming-only-product')).toBe(true)
    await expect(svc.getGameById('upcoming-only-product')).resolves.toMatchObject({
      id: 'upcoming-only-product',
      name: 'upcoming-only',
    })
  })

  it('returns empty result when no concepts exist for a feature', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? baseConcepts : [],
    )

    const svc = await import('../services/gamesService.js')

    const { games: upcoming } = await svc.getUpcomingGames()
    const { games: discounted } = await svc.getDiscountedGames()
    const { games: plus } = await svc.getPlusGames()

    expect(upcoming.length).toBe(0)
    expect(discounted.length).toBe(0)
    expect(plus.length).toBe(0)
  })

  it('returns all concepts from API without client-side date filtering', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature !== 'new') return []
      return [
        makeConcept('game-a'),
        makeConcept('game-b'),
        makeConcept('game-no-date', { products: [{ id: 'nd-1' }] }),
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()

    expect(games).toHaveLength(3)
    expect(games.map((g) => g.name)).toEqual(['game-a', 'game-b', 'game-no-date'])
  })

  it('preserves Sony API order for all listing endpoints', async () => {
    const orderedConcepts = [
      makeConcept('first'),
      makeConcept('second'),
      makeConcept('third'),
    ]

    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') return orderedConcepts
      if (feature === 'discounted') return orderedConcepts
      if (feature === 'upcoming') return orderedConcepts
      if (feature === 'plus') return orderedConcepts
      return []
    })

    const svc = await import('../services/gamesService.js')

    for (const fn of [svc.getNewGames, svc.getUpcomingGames, svc.getDiscountedGames, svc.getPlusGames]) {
      const { games } = await fn()
      expect(games.map((g) => g.name)).toEqual(['first', 'second', 'third'])
    }
  })

  it('listing endpoints do not call fetchProductReleaseDate', async () => {
    const svc = await import('../services/gamesService.js')
    await svc.getNewGames()
    await svc.getUpcomingGames()
    await svc.getDiscountedGames()
    await svc.getPlusGames()
    expect(fetchProductReleaseDate).not.toHaveBeenCalled()
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

  it('discounted returns all games from deals feed', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') return baseConcepts
      if (feature !== 'discounted') return []
      return [
        makeConcept('deal-a'),
        makeConcept('deal-b'),
        makeConcept('deal-c'),
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getDiscountedGames()

    expect(games).toHaveLength(3)
    expect(games.map((g) => g.name)).toEqual(['deal-a', 'deal-b', 'deal-c'])
  })
})
