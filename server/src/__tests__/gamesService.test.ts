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
  products: [{ id: `${name}-product`, releaseDate: '2025-01-01T00:00:00Z' }],
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
  fetchProductDetail.mockImplementation(async (productId: string) => ({
    releaseDate: productId.includes('future') ? '2099-01-01T00:00:00Z' : '2025-01-01T00:00:00Z',
    genres: [],
    description: '',
  }))

  fetchConceptsByFeature.mockImplementation(async (feature: string) => {
    if (feature === 'new') return baseConcepts
    if (feature === 'upcoming') return [makeConcept('future', { products: [{ id: 'future-p', releaseDate: '2099-01-01T00:00:00Z' }] })]
    if (feature === 'discounted') return [baseConcepts[1]]
    if (feature === 'plus') return [baseConcepts[1]]
    return []
  })

  fetchProductReleaseDate.mockImplementation(async (productId: string) =>
    productId.includes('future') ? '2099-01-01T00:00:00Z' : '2025-01-01T00:00:00Z',
  )
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
            products: [{ id: 'upcoming-only-product', releaseDate: '2099-01-01T00:00:00Z' }],
          }),
        ]
      }
      return []
    })

    fetchProductReleaseDate.mockImplementation(async (productId: string) =>
      productId === 'upcoming-only-product' ? '2099-01-01T00:00:00Z' : '2025-01-01T00:00:00Z',
    )

    const svc = await import('../services/gamesService.js')
    const { games: upcoming } = await svc.getUpcomingGames()

    expect(upcoming.some((game) => game.id === 'upcoming-only-product')).toBe(true)
    await expect(svc.getGameById('upcoming-only-product')).resolves.toMatchObject({
      id: 'upcoming-only-product',
      name: 'upcoming-only',
    })
  })

  it('returns strict empty result when no valid upcoming/discounted records exist', async () => {
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

  it('excludes upcoming records with missing releaseDate', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') return baseConcepts
      if (feature === 'upcoming') return [makeConcept('upcoming-no-date', { products: [{ id: 'u-1' }] })]
      return []
    })

    const svc = await import('../services/gamesService.js')
    const { games: upcoming } = await svc.getUpcomingGames()

    expect(upcoming).toHaveLength(0)
  })

  it('new returns only released games with valid dates in descending order', async () => {
    const now = Date.now()
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature !== 'new') {
        return []
      }

      return [
        makeConcept('released-late', { products: [{ id: 'r-l', releaseDate: '2026-01-01T00:00:00Z' }] }),
        makeConcept('released-early', { products: [{ id: 'r-e', releaseDate: '2025-01-01T00:00:00Z' }] }),
        makeConcept('future', { products: [{ id: 'f-1', releaseDate: '2099-01-01T00:00:00Z' }] }),
        makeConcept('unknown-date', { products: [{ id: 'u-1' }] }),
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games: results } = await svc.getNewGames()

    expect(results.every((game) => Number.isFinite(Date.parse(game.date)))).toBe(true)
    expect(results.every((game) => Date.parse(game.date) <= now)).toBe(true)
    expect(results.map((game) => game.name)).toEqual(['released-late', 'released-early'])
  })

  it('upcoming returns only future games with valid dates in ascending order', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') {
        return baseConcepts
      }
      if (feature !== 'upcoming') {
        return []
      }

      return [
        makeConcept('future-late', { products: [{ id: 'f-l', releaseDate: '2099-02-01T00:00:00Z' }] }),
        makeConcept('future-soon', { products: [{ id: 'f-s', releaseDate: '2099-01-01T00:00:00Z' }] }),
        makeConcept('released', { products: [{ id: 'r-1', releaseDate: '2025-01-01T00:00:00Z' }] }),
        makeConcept('unknown', { products: [{ id: 'u-1' }] }),
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games: results } = await svc.getUpcomingGames()

    expect(results.every((game) => Number.isFinite(Date.parse(game.date)))).toBe(true)
    expect(results.every((game) => Date.parse(game.date) > Date.now())).toBe(true)
    expect(results.map((game) => game.name)).toEqual(['future-soon', 'future-late'])
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
      makeConcept(`game-${i}`, {
        products: [{ id: `p-${i}`, releaseDate: `2025-0${Math.min(i + 1, 9)}-01T00:00:00Z` }],
      }),
    )

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const page = await svc.getNewGames(0, 3)

    expect(page.games).toHaveLength(3)
    expect(page.totalCount).toBeGreaterThanOrEqual(3)
    expect(page.nextOffset).toBe(3)
  })

  it('getNewGames returns null nextOffset on last page', async () => {
    const svc = await import('../services/gamesService.js')
    const page = await svc.getNewGames(0, 200)

    expect(page.nextOffset).toBeNull()
  })

  it('discounted returns all released games from deals feed in descending order', async () => {
    fetchConceptsByFeature.mockImplementation(async (feature: string) => {
      if (feature === 'new') {
        return baseConcepts
      }
      if (feature !== 'discounted') {
        return []
      }

      return [
        makeConcept('deal-recent', {
          products: [{ id: 'd-r', releaseDate: '2026-02-01T00:00:00Z' }],
        }),
        makeConcept('deal-old', {
          products: [{ id: 'd-o', releaseDate: '2025-02-01T00:00:00Z' }],
        }),
        makeConcept('deal-future', {
          products: [{ id: 'd-f', releaseDate: '2099-01-01T00:00:00Z' }],
        }),
      ]
    })

    const svc = await import('../services/gamesService.js')
    const { games: results } = await svc.getDiscountedGames()

    expect(results.every((game) => Date.parse(game.date) <= Date.now())).toBe(true)
    expect(results.map((game) => game.name)).toEqual(['deal-recent', 'deal-old'])
  })
})
