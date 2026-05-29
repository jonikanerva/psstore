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
    id: String(conceptCounter),
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
    storeDisplayClassification: 'FULL_GAME',
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
    return []
  })
})

describe('gamesService', () => {
  it('returns non-empty sets for all feature tabs', async () => {
    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('FUTURE') ? FUTURE_DATE : PAST_DATE,
      genres: [],
      description: '',
      storeDisplayClassification: 'FULL_GAME',
    }))

    const svc = await import('../services/gamesService.js')

    expect((await svc.getNewGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getUpcomingGames()).games.length).toBeGreaterThan(0)
    expect((await svc.getDiscountedGames()).games.length).toBeGreaterThan(0)
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
    const upcomingProduct = upcomingConcept.products[0]
    if (!upcomingProduct) {
      throw new Error('test fixture missing upcoming product')
    }
    const upcomingProductId = upcomingProduct.id

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

    expect(upcoming.length).toBe(0)
    expect(discounted.length).toBe(0)
  })

  it('new excludes future games (released date gate)', async () => {
    const concepts = [
      makeConcept('released'),
      makeConcept('future'),
    ]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('RELEASED') ? '2024-01-01T00:00:00Z' : FUTURE_DATE,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')

    const { games: newGames } = await svc.getNewGames()
    expect(newGames.map((g) => g.name)).toEqual(['released'])
  })

  it('upcoming keeps trailing-edge survivors whose date has just passed', async () => {
    // The `next_thirty_days` facet already bounds the window upstream
    // (queryStrategies.ts). The previous per-product `> now` re-filter dropped
    // concepts inside that facet window whose enriched date had slipped just
    // into the past between the grid snapshot and enrichment (live: 7 of 12).
    // With DateFilter 'none' both the just-passed and the future survivor stay,
    // ascending by date.
    const now = Date.now()
    const justPassedIso = new Date(now - 60 * 60 * 1000).toISOString()
    const futureIso = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString()
    const concepts = [makeConcept('future-edge'), makeConcept('just-passed')]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('JUSTPASSED') ? justPassedIso : futureIso,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getUpcomingGames()

    expect(games.map((g) => g.name)).toEqual(['just-passed', 'future-edge'])
  })

  it('upcoming keeps a dated product SKU ahead of an undated one', async () => {
    // Owner ruling 2026-05-29 (option a): UPCOMING no longer drops empty-date
    // entries. A product SKU whose enriched date is empty (Sony has not dated it
    // yet) is kept and sorts last via the +Infinity ascending sentinel, behind
    // the dated SKU.
    const futureIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const concepts = [makeConcept('no-date'), makeConcept('has-date')]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('HASDATE') ? futureIso : undefined,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getUpcomingGames()

    expect(games.map((g) => g.name)).toEqual(['has-date', 'no-date'])
    expect(games.every((g) => g.idKind === 'product')).toBe(true)
  })

  it('upcoming surfaces concept-only announcements without a price or date', async () => {
    // Concept-only entries (Sony returns `products: []`, `price: null`, a bare
    // numeric concept id) must appear in UPCOMING as `idKind: 'concept'` with an
    // empty price and date — they are dropped only by the SKU-gated shared
    // mapper used by NEW / DISCOUNTED, not by the UPCOMING path.
    const skuConcept = makeConcept('sku-title')
    const conceptOnlyA = { id: '10018729', name: 'concept-a', media: [], price: null, products: [] }
    const conceptOnlyB = { id: '10019188', name: 'concept-b', media: [], price: null, products: [] }
    const futureIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: futureIso,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? [skuConcept, conceptOnlyA, conceptOnlyB] : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getUpcomingGames()

    expect(games).toHaveLength(3)
    const a = games.find((g) => g.name === 'concept-a')
    const b = games.find((g) => g.name === 'concept-b')
    expect(a).toMatchObject({ id: '10018729', idKind: 'concept', price: '', date: '' })
    expect(b).toMatchObject({ id: '10019188', idKind: 'concept', price: '', date: '' })
    expect(games.find((g) => g.name === 'sku-title')?.idKind).toBe('product')
  })

  it('upcoming sorts dated SKU cards before undated concept cards in grid order', async () => {
    const skuConcept = makeConcept('sku-title')
    const conceptFirst = { id: '10010001', name: 'concept-first', media: [], price: null, products: [] }
    const conceptSecond = { id: '10010002', name: 'concept-second', media: [], price: null, products: [] }
    const futureIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: futureIso,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? [conceptFirst, skuConcept, conceptSecond] : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getUpcomingGames()

    // The dated SKU card sorts first; the two undated concept cards keep their
    // upstream grid order (stable index tiebreaker on the +Infinity sentinel).
    expect(games.map((g) => g.name)).toEqual(['sku-title', 'concept-first', 'concept-second'])
  })

  it('upcoming enriches only product SKUs, never a concept id', async () => {
    const skuConcept = makeConcept('sku-title')
    const skuProductId = skuConcept.products[0]?.id
    const conceptOnly = { id: '10018729', name: 'concept-a', media: [], price: null, products: [] }
    const futureIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

    const detailCalls: string[] = []
    fetchProductDetail.mockImplementation(async (productId: string) => {
      detailCalls.push(productId)
      return { releaseDate: futureIso, genres: [], description: '' }
    })

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? [skuConcept, conceptOnly] : [],
    )

    const svc = await import('../services/gamesService.js')
    await svc.getUpcomingGames()

    expect(detailCalls).toEqual([skuProductId])
    expect(detailCalls).not.toContain('10018729')
  })

  it('getGameById rejects a bare concept id with 404 and never enriches it', async () => {
    // A concept deep-link must not resolve to an internal PDP. The SKU-gated
    // baseGames + findGameInFeatureConcepts both miss, so getGameById 404s
    // without ever calling the product-detail boundary on the concept id.
    const conceptOnly = { id: '10018729', name: 'concept-a', media: [], price: null, products: [] }

    const detailCalls: string[] = []
    fetchProductDetail.mockImplementation(async (productId: string) => {
      detailCalls.push(productId)
      return { releaseDate: PAST_DATE, genres: [], description: '' }
    })

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'upcoming' ? [conceptOnly] : [],
    )

    const svc = await import('../services/gamesService.js')

    await expect(svc.getGameById('10018729')).rejects.toMatchObject({ status: 404, code: 'GAME_NOT_FOUND' })
    expect(detailCalls).not.toContain('10018729')
  })

  it('new/discounted sort by date descending', async () => {
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

  it('discounted excludes non-game store classifications', async () => {
    // VISION forbids DLC / currency / themes / characters. DISCOUNTED keeps only
    // the FULL_GAME / GAME_BUNDLE allow-list; everything else is dropped.
    const concepts = [
      makeConcept('full-game'),
      makeConcept('game-bundle'),
      makeConcept('add-on'),
      makeConcept('currency'),
      makeConcept('vehicle'),
    ]

    const classificationByMarker: Record<string, string> = {
      FULLGAME: 'FULL_GAME',
      GAMEBUNDLE: 'GAME_BUNDLE',
      ADDON: 'ADD_ON_PACK',
      CURRENCY: 'VIRTUAL_CURRENCY',
      VEHICLE: 'VEHICLE',
    }

    fetchProductDetail.mockImplementation(async (productId: string) => {
      const marker = Object.keys(classificationByMarker).find((key) => productId.includes(key))
      return {
        releaseDate: PAST_DATE,
        genres: [],
        description: '',
        storeDisplayClassification: marker ? classificationByMarker[marker] : undefined,
      }
    })

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'discounted' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getDiscountedGames()

    expect(games.map((g) => g.name).sort()).toEqual(['full-game', 'game-bundle'])
  })

  it('discounted keeps future-dated deals (no released date gate)', async () => {
    // DISCOUNTED drops the NEW-style `released` gate so a valid future-dated deal
    // is not stranded.
    const concepts = [makeConcept('future-deal')]

    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: FUTURE_DATE,
      genres: [],
      description: '',
      storeDisplayClassification: 'FULL_GAME',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'discounted' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getDiscountedGames()

    expect(games.map((g) => g.name)).toEqual(['future-deal'])
  })

  it('discounted sorts by date descending', async () => {
    const concepts = [makeConcept('old'), makeConcept('recent'), makeConcept('mid')]

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: productId.includes('OLD') ? '2023-01-01T00:00:00Z'
        : productId.includes('RECENT') ? '2025-06-01T00:00:00Z'
        : '2024-06-01T00:00:00Z',
      genres: [],
      description: '',
      storeDisplayClassification: 'FULL_GAME',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'discounted' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getDiscountedGames()

    expect(games.map((g) => g.name)).toEqual(['recent', 'mid', 'old'])
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
      makeConcept(`game-${String(i)}`),
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

  it('enriches game with publisher name from product detail', async () => {
    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: PAST_DATE,
      genres: ['Strategy'],
      description: '<p>Grand strategy</p>',
      publisherName: 'PARADOX GAMES INC',
    }))

    const svc = await import('../services/gamesService.js')
    const firstNew = (await svc.getNewGames()).games[0]
    if (!firstNew) {
      throw new Error('test expected at least one new game')
    }
    const game = await svc.getGameById(firstNew.id)

    expect(game.studio).toBe('PARADOX GAMES INC')
  })

  it('getNewGames returns null nextOffset on last page', async () => {
    const svc = await import('../services/gamesService.js')
    const page = await svc.getNewGames(0, 200)

    expect(page.nextOffset).toBeNull()
  })

  it('surfaces a recent release beyond the legacy 120-concept prefix', async () => {
    // Regression for the NEW-list defect: a genuinely recent release that sits
    // past grid position 120 (007 First Light landed at 126 live) must still
    // appear, and the head must stay strictly date-desc. This fails under the
    // old blind 120-prefix and passes once the NEW window widens.
    const total = 130
    const recentIndex = 126
    const recentTitle = 'beyond-prefix'
    const now = Date.now()
    const threeDaysAgoIso = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
    const olderIso = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString()
    const futureIso = FUTURE_DATE

    const dateByProductId = new Map<string, string>()
    const concepts = Array.from({ length: total }, (_, i) => {
      const concept = makeConcept(i === recentIndex ? recentTitle : `filler-${String(i)}`)
      const productId = concept.products[0]?.id
      if (!productId) {
        throw new Error('test fixture missing product id')
      }
      // The recent release is the newest released item; fillers alternate
      // older-released and far-future (filtered out) so the recent one must win
      // the date-desc sort among released games.
      const date = i === recentIndex ? threeDaysAgoIso : i % 3 === 0 ? futureIso : olderIso
      dateByProductId.set(productId, date)
      return concept
    })

    fetchProductDetail.mockImplementation(async (productId: string) => ({
      releaseDate: dateByProductId.get(productId) ?? olderIso,
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames(0, total)

    expect(games.some((g) => g.name === recentTitle)).toBe(true)
    expect(games[0]?.name).toBe(recentTitle)
  })

  it('requests a NEW window wide enough to cover the released facet set', async () => {
    // Guards against a future edit silently reintroducing a small prefix cap.
    // The live `last_thirty_days` released set is ~177; the window must stay
    // comfortably above it.
    const seen: number[] = []
    fetchConceptsByFeature.mockImplementation(async (feature: string, size?: number) => {
      if (feature === 'new') {
        seen.push(size ?? 0)
        return [makeConcept('any')]
      }
      return []
    })

    const svc = await import('../services/gamesService.js')
    await svc.getNewGames()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((size) => size >= 300)).toBe(true)
  })

  it('orders games with equal release dates by upstream concept order (stable)', async () => {
    // All three concepts share one parsed timestamp, so ordering must fall back
    // to the upstream `conceptReleaseDate`-desc grid order rather than reorder
    // nondeterministically (spike doc, section B).
    const concepts = [makeConcept('first'), makeConcept('second'), makeConcept('third')]

    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: '2025-01-01T00:00:00Z',
      genres: [],
      description: '',
    }))

    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? concepts : [],
    )

    const svc = await import('../services/gamesService.js')
    const { games } = await svc.getNewGames()

    expect(games.map((g) => g.name)).toEqual(['first', 'second', 'third'])
  })
})

describe('getGameById detail enrichment (function-injection seam)', () => {
  it('enriches the game with LONG description and localized genres', async () => {
    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: PAST_DATE,
      genres: [],
      description: '',
    }))
    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? [makeConcept('detailed')] : [],
    )

    const svc = await import('../services/gamesService.js')
    const baseGame = (await svc.getNewGames()).games[0]
    if (!baseGame) {
      throw new Error('test expected at least one new game')
    }

    const fakeFetchDetail = async (): Promise<{
      releaseDate: string
      genres: string[]
      description: string
      publisherName: string
    }> => ({
      releaseDate: PAST_DATE,
      genres: ['Toiminta', 'Roolipelit'],
      description: '<p>The long game info body.</p>',
      publisherName: 'STUDIO OY',
    })

    const game = await svc.getGameById(baseGame.id, fakeFetchDetail)

    expect(game.description).toBe('<p>The long game info body.</p>')
    expect(game.genres).toEqual(['Toiminta', 'Roolipelit'])
    expect(game.studio).toBe('STUDIO OY')
  })

  it('degrades to the un-enriched game when the detail fetch rejects', async () => {
    fetchProductDetail.mockImplementation(async () => ({
      releaseDate: PAST_DATE,
      genres: [],
      description: '',
    }))
    fetchConceptsByFeature.mockImplementation(async (feature: string) =>
      feature === 'new' ? [makeConcept('degraded')] : [],
    )

    const svc = await import('../services/gamesService.js')
    const baseGame = (await svc.getNewGames()).games[0]
    if (!baseGame) {
      throw new Error('test expected at least one new game')
    }

    const rejectingFetchDetail = async (): Promise<never> => {
      throw new Error('upstream unavailable')
    }

    const game = await svc.getGameById(baseGame.id, rejectingFetchDetail)

    expect(game.id).toBe(baseGame.id)
    expect(game.name).toBe('degraded')
    expect(game.description).toBe('')
    expect(game.genres).toEqual([])
  })
})
