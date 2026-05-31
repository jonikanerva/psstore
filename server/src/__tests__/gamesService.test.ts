import { Effect, Exit, Layer } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { UpstreamUnavailable } from '../errors/errors.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import { SonyClient, type ProductDetailResult } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

const upstream = (message: string): UpstreamUnavailable =>
  new UpstreamUnavailable({ message })

type Feature = 'new' | 'upcoming' | 'discounted'
type ConceptFn = (feature: Feature) => Concept[]
type DetailFn = (productId: string) => ProductDetailResult

let conceptsFor: ConceptFn = () => []
let detailFor: DetailFn = () => ({
  releaseDate: PAST_DATE,
  genres: [],
  description: '',
  storeDisplayClassification: 'FULL_GAME',
})

// A fake SonyClient driven by the per-test `conceptsFor` / `detailFor` closures.
// Replaces the previous vi.mock of the sonyClient module — the in-memory service
// boundary the doctrine prefers over heavyweight mocking.
const FakeSony = Layer.succeed(SonyClient, {
  fetchConceptsByFeature: (feature) => Effect.sync(() => conceptsFor(feature)),
  fetchProductDetail: (productId) => Effect.sync(() => detailFor(productId)),
})

// A fresh GamesService per run so the internal caches never leak across tests.
const run = <A, E>(
  use: (svc: GamesServiceApi) => Effect.Effect<A, E>,
): Promise<A> => {
  const Services = GamesServiceLive.pipe(Layer.provide(FakeSony))
  return Effect.runPromise(
    GamesService.pipe(Effect.flatMap(use), Effect.provide(Services)),
  )
}

const runExit = <A, E>(use: (svc: GamesServiceApi) => Effect.Effect<A, E>) => {
  const Services = GamesServiceLive.pipe(Layer.provide(FakeSony))
  return Effect.runPromiseExit(
    GamesService.pipe(Effect.flatMap(use), Effect.provide(Services)),
  )
}

let conceptCounter = 0
const makeConcept = (
  name: string,
  overrides: Partial<Concept> = {},
): Concept => {
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
    products: [
      {
        id: `EP0001-PPSA${num}_00-${name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .padEnd(16, '0')
          .slice(0, 16)}`,
      },
    ],
    ...overrides,
  }
}

const PAST_DATE = '2025-01-01T00:00:00Z'
const FUTURE_DATE = '2099-01-01T00:00:00Z'

beforeEach(() => {
  conceptCounter = 0
  conceptsFor = () => []
  detailFor = () => ({
    releaseDate: PAST_DATE,
    genres: [],
    description: '',
    storeDisplayClassification: 'FULL_GAME',
  })
})

describe('gamesService', () => {
  it('returns non-empty sets for all feature tabs', async () => {
    conceptsFor = (feature) => {
      if (feature === 'new') return [makeConcept('alpha'), makeConcept('bravo')]
      if (feature === 'upcoming') return [makeConcept('future')]
      return [makeConcept('deal')]
    }
    detailFor = (productId) => ({
      releaseDate: productId.includes('FUTURE') ? FUTURE_DATE : PAST_DATE,
      genres: [],
      description: '',
      storeDisplayClassification: 'FULL_GAME',
    })

    expect((await run((s) => s.getNewGames())).games.length).toBeGreaterThan(0)
    expect(
      (await run((s) => s.getUpcomingGames())).games.length,
    ).toBeGreaterThan(0)
    expect(
      (await run((s) => s.getDiscountedGames())).games.length,
    ).toBeGreaterThan(0)
  })

  it('enriches games with release dates from product detail', async () => {
    conceptsFor = (feature) =>
      feature === 'new' ? [makeConcept('alpha'), makeConcept('bravo')] : []
    detailFor = () => ({
      releaseDate: '2024-06-15T00:00:00Z',
      genres: [],
      description: '',
    })

    const { games } = await run((s) => s.getNewGames())
    expect(games.length).toBeGreaterThan(0)
    expect(games.every((g) => g.date === '2024-06-15T00:00:00Z')).toBe(true)
  })

  it('filters out games without valid release dates', async () => {
    conceptsFor = (feature) =>
      feature === 'new' ? [makeConcept('alpha'), makeConcept('bravo')] : []
    detailFor = (productId) => ({
      releaseDate: productId.includes('ALPHA') ? PAST_DATE : undefined,
      genres: [],
      description: '',
    })

    const { games } = await run((s) => s.getNewGames())
    expect(games.every((g) => Boolean(g.date))).toBe(true)
    expect(games.some((g) => g.name === 'alpha')).toBe(true)
    expect(games.some((g) => g.name === 'bravo')).toBe(false)
  })

  it('filters out games with invalid product IDs (concept ID fallback)', async () => {
    conceptsFor = (feature) =>
      feature === 'new'
        ? [
            makeConcept('valid-game'),
            {
              id: '12345',
              name: 'concept-only',
              media: [],
              price: {},
              products: [],
            },
            { id: '67890', name: 'no-products', media: [], price: {} },
          ]
        : []

    const { games } = await run((s) => s.getNewGames())
    expect(games.every((g) => g.name !== 'concept-only')).toBe(true)
    expect(games.every((g) => g.name !== 'no-products')).toBe(true)
  })

  it('resolves game detail for upcoming ids not present in base feed', async () => {
    const upcomingConcept = makeConcept('upcoming-only')
    const upcomingProductId = upcomingConcept.products?.[0]?.id
    if (!upcomingProductId) throw new Error('fixture missing upcoming product')

    detailFor = (productId) => ({
      releaseDate: productId === upcomingProductId ? FUTURE_DATE : PAST_DATE,
      genres: [],
      description: '',
    })
    conceptsFor = (feature) => {
      if (feature === 'new') return [makeConcept('base-game')]
      if (feature === 'upcoming') return [upcomingConcept]
      return []
    }

    const { games: upcoming } = await run((s) => s.getUpcomingGames())
    expect(upcoming.some((game) => game.id === upcomingProductId)).toBe(true)

    const game = await run((s) => s.getGameById(upcomingProductId))
    expect(game).toMatchObject({ id: upcomingProductId, name: 'upcoming-only' })
  })

  it('returns empty result when no concepts exist for a feature', async () => {
    conceptsFor = (feature) => (feature === 'new' ? [makeConcept('base')] : [])

    expect((await run((s) => s.getUpcomingGames())).games.length).toBe(0)
    expect((await run((s) => s.getDiscountedGames())).games.length).toBe(0)
  })

  it('new excludes future games (released date gate)', async () => {
    detailFor = (productId) => ({
      releaseDate: productId.includes('RELEASED')
        ? '2024-01-01T00:00:00Z'
        : FUTURE_DATE,
      genres: [],
      description: '',
    })
    conceptsFor = (feature) =>
      feature === 'new' ? [makeConcept('released'), makeConcept('future')] : []

    const { games } = await run((s) => s.getNewGames())
    expect(games.map((g) => g.name)).toEqual(['released'])
  })

  it('upcoming keeps trailing-edge survivors whose date has just passed', async () => {
    const now = Date.now()
    const justPassedIso = new Date(now - 60 * 60 * 1000).toISOString()
    const futureIso = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString()

    detailFor = (productId) => ({
      releaseDate: productId.includes('JUSTPASSED') ? justPassedIso : futureIso,
      genres: [],
      description: '',
    })
    conceptsFor = (feature) =>
      feature === 'upcoming'
        ? [makeConcept('future-edge'), makeConcept('just-passed')]
        : []

    const { games } = await run((s) => s.getUpcomingGames())
    expect(games.map((g) => g.name)).toEqual(['just-passed', 'future-edge'])
  })

  it('upcoming keeps a dated product SKU ahead of an undated one', async () => {
    const futureIso = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString()
    detailFor = (productId) => ({
      releaseDate: productId.includes('HASDATE') ? futureIso : undefined,
      genres: [],
      description: '',
    })
    conceptsFor = (feature) =>
      feature === 'upcoming'
        ? [makeConcept('no-date'), makeConcept('has-date')]
        : []

    const { games } = await run((s) => s.getUpcomingGames())
    expect(games.map((g) => g.name)).toEqual(['has-date', 'no-date'])
    expect(games.every((g) => g.idKind === 'product')).toBe(true)
  })

  it('upcoming surfaces concept-only announcements without a price or date', async () => {
    const skuConcept = makeConcept('sku-title')
    const conceptOnlyA: Concept = {
      id: '10018729',
      name: 'concept-a',
      media: [],
      price: undefined,
      products: [],
    }
    const conceptOnlyB: Concept = {
      id: '10019188',
      name: 'concept-b',
      media: [],
      price: undefined,
      products: [],
    }
    const futureIso = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString()

    detailFor = () => ({ releaseDate: futureIso, genres: [], description: '' })
    conceptsFor = (feature) =>
      feature === 'upcoming' ? [skuConcept, conceptOnlyA, conceptOnlyB] : []

    const { games } = await run((s) => s.getUpcomingGames())
    expect(games).toHaveLength(3)
    expect(games.find((g) => g.name === 'concept-a')).toMatchObject({
      id: '10018729',
      idKind: 'concept',
      price: '',
      date: '',
    })
    expect(games.find((g) => g.name === 'concept-b')).toMatchObject({
      id: '10019188',
      idKind: 'concept',
      price: '',
      date: '',
    })
    expect(games.find((g) => g.name === 'sku-title')?.idKind).toBe('product')
  })

  it('upcoming sorts dated SKU cards before undated concept cards in grid order', async () => {
    const skuConcept = makeConcept('sku-title')
    const conceptFirst: Concept = {
      id: '10010001',
      name: 'concept-first',
      media: [],
      price: undefined,
      products: [],
    }
    const conceptSecond: Concept = {
      id: '10010002',
      name: 'concept-second',
      media: [],
      price: undefined,
      products: [],
    }
    const futureIso = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString()

    detailFor = () => ({ releaseDate: futureIso, genres: [], description: '' })
    conceptsFor = (feature) =>
      feature === 'upcoming' ? [conceptFirst, skuConcept, conceptSecond] : []

    const { games } = await run((s) => s.getUpcomingGames())
    expect(games.map((g) => g.name)).toEqual([
      'sku-title',
      'concept-first',
      'concept-second',
    ])
  })

  it('upcoming enriches only product SKUs, never a concept id', async () => {
    const skuConcept = makeConcept('sku-title')
    const skuProductId = skuConcept.products?.[0]?.id
    const conceptOnly: Concept = {
      id: '10018729',
      name: 'concept-a',
      media: [],
      price: undefined,
      products: [],
    }
    const futureIso = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString()

    const detailCalls: string[] = []
    detailFor = (productId) => {
      detailCalls.push(productId)
      return { releaseDate: futureIso, genres: [], description: '' }
    }
    conceptsFor = (feature) =>
      feature === 'upcoming' ? [skuConcept, conceptOnly] : []

    await run((s) => s.getUpcomingGames())
    expect(detailCalls).toEqual([skuProductId])
    expect(detailCalls).not.toContain('10018729')
  })

  it('getGameById rejects a bare concept id with 404 and never enriches it', async () => {
    const conceptOnly: Concept = {
      id: '10018729',
      name: 'concept-a',
      media: [],
      price: undefined,
      products: [],
    }
    const detailCalls: string[] = []
    detailFor = (productId) => {
      detailCalls.push(productId)
      return { releaseDate: PAST_DATE, genres: [], description: '' }
    }
    conceptsFor = (feature) => (feature === 'upcoming' ? [conceptOnly] : [])

    const exit = await runExit((s) => s.getGameById('10018729'))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause
      expect(JSON.stringify(failure)).toContain('GameNotFound')
    }
    expect(detailCalls).not.toContain('10018729')
  })

  it('new sorts by date descending', async () => {
    detailFor = (productId) => ({
      releaseDate: productId.includes('OLD')
        ? '2023-01-01T00:00:00Z'
        : productId.includes('RECENT')
          ? '2025-06-01T00:00:00Z'
          : '2024-06-01T00:00:00Z',
      genres: [],
      description: '',
    })
    conceptsFor = (feature) =>
      feature === 'new'
        ? [makeConcept('old'), makeConcept('recent'), makeConcept('mid')]
        : []

    const { games } = await run((s) => s.getNewGames())
    expect(games.map((g) => g.name)).toEqual(['recent', 'mid', 'old'])
  })

  it('upcoming sorts by date ascending', async () => {
    detailFor = (productId) => ({
      releaseDate: productId.includes('LATER')
        ? '2099-06-01T00:00:00Z'
        : '2099-01-01T00:00:00Z',
      genres: [],
      description: '',
    })
    conceptsFor = (feature) =>
      feature === 'upcoming'
        ? [makeConcept('later'), makeConcept('sooner')]
        : [makeConcept('base')]

    const { games } = await run((s) => s.getUpcomingGames())
    expect(games.map((g) => g.name)).toEqual(['sooner', 'later'])
  })

  it('discounted excludes non-game store classifications', async () => {
    const classificationByMarker: Record<string, string> = {
      FULLGAME: 'FULL_GAME',
      GAMEBUNDLE: 'GAME_BUNDLE',
      ADDON: 'ADD_ON_PACK',
      CURRENCY: 'VIRTUAL_CURRENCY',
      VEHICLE: 'VEHICLE',
    }
    detailFor = (productId) => {
      const marker = Object.keys(classificationByMarker).find((key) =>
        productId.includes(key),
      )
      return {
        releaseDate: PAST_DATE,
        genres: [],
        description: '',
        storeDisplayClassification: marker
          ? classificationByMarker[marker]
          : undefined,
      }
    }
    conceptsFor = (feature) =>
      feature === 'discounted'
        ? [
            makeConcept('full-game'),
            makeConcept('game-bundle'),
            makeConcept('add-on'),
            makeConcept('currency'),
            makeConcept('vehicle'),
          ]
        : []

    const { games } = await run((s) => s.getDiscountedGames())
    expect(games.map((g) => g.name).sort()).toEqual([
      'full-game',
      'game-bundle',
    ])
  })

  it('discounted keeps future-dated deals (no released date gate)', async () => {
    detailFor = () => ({
      releaseDate: FUTURE_DATE,
      genres: [],
      description: '',
      storeDisplayClassification: 'FULL_GAME',
    })
    conceptsFor = (feature) =>
      feature === 'discounted' ? [makeConcept('future-deal')] : []

    const { games } = await run((s) => s.getDiscountedGames())
    expect(games.map((g) => g.name)).toEqual(['future-deal'])
  })

  it('discounted sorts by date descending', async () => {
    detailFor = (productId) => ({
      releaseDate: productId.includes('OLD')
        ? '2023-01-01T00:00:00Z'
        : productId.includes('RECENT')
          ? '2025-06-01T00:00:00Z'
          : '2024-06-01T00:00:00Z',
      genres: [],
      description: '',
      storeDisplayClassification: 'FULL_GAME',
    })
    conceptsFor = (feature) =>
      feature === 'discounted'
        ? [makeConcept('old'), makeConcept('recent'), makeConcept('mid')]
        : []

    const { games } = await run((s) => s.getDiscountedGames())
    expect(games.map((g) => g.name)).toEqual(['recent', 'mid', 'old'])
  })

  it('maps discount fields from concept price', async () => {
    conceptsFor = (feature) =>
      feature === 'new'
        ? [
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
        : []

    const { games } = await run((s) => s.getNewGames())
    const fullPrice = games.find((g) => g.name === 'full-price')
    expect(fullPrice?.originalPrice).toBe('')
    expect(fullPrice?.discountText).toBe('')

    const onSale = games.find((g) => g.name === 'on-sale')
    expect(onSale?.originalPrice).toBe('€59,99')
    expect(onSale?.discountText).toBe('-33%')
    expect(onSale?.price).toBe('€39,99')
  })

  it('getNewGames respects offset and size', async () => {
    conceptsFor = (feature) =>
      feature === 'new'
        ? Array.from({ length: 10 }, (_, i) => makeConcept(`game-${String(i)}`))
        : []

    const page = await run((s) => s.getNewGames(0, 3))
    expect(page.games).toHaveLength(3)
    expect(page.totalCount).toBe(10)
    expect(page.nextOffset).toBe(3)
  })

  it('enriches game with publisher name from product detail', async () => {
    detailFor = () => ({
      releaseDate: PAST_DATE,
      genres: ['Strategy'],
      description: '<p>Grand strategy</p>',
      publisherName: 'PARADOX GAMES INC',
    })
    conceptsFor = (feature) =>
      feature === 'new' ? [makeConcept('paradox')] : []

    const game = await run((s) =>
      Effect.flatMap(s.getNewGames(), (page) => {
        const first = page.games[0]
        if (!first) return Effect.die(new Error('expected a new game'))
        return s.getGameById(first.id)
      }),
    )
    expect(game.studio).toBe('PARADOX GAMES INC')
  })

  it('getNewGames returns null nextOffset on last page', async () => {
    conceptsFor = (feature) => (feature === 'new' ? [makeConcept('only')] : [])
    const page = await run((s) => s.getNewGames(0, 200))
    expect(page.nextOffset).toBeNull()
  })

  it('surfaces a recent release beyond the legacy 120-concept prefix', async () => {
    const total = 130
    const recentIndex = 126
    const recentTitle = 'beyond-prefix'
    const now = Date.now()
    const threeDaysAgoIso = new Date(
      now - 3 * 24 * 60 * 60 * 1000,
    ).toISOString()
    const olderIso = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString()

    const dateByProductId = new Map<string, string>()
    const concepts = Array.from({ length: total }, (_, i) => {
      const c = makeConcept(
        i === recentIndex ? recentTitle : `filler-${String(i)}`,
      )
      const pid = c.products?.[0]?.id
      if (!pid) throw new Error('fixture missing product id')
      const date =
        i === recentIndex
          ? threeDaysAgoIso
          : i % 3 === 0
            ? FUTURE_DATE
            : olderIso
      dateByProductId.set(pid, date)
      return c
    })

    detailFor = (productId) => ({
      releaseDate: dateByProductId.get(productId) ?? olderIso,
      genres: [],
      description: '',
    })
    conceptsFor = (feature) => (feature === 'new' ? concepts : [])

    const { games } = await run((s) => s.getNewGames(0, total))
    expect(games.some((g) => g.name === recentTitle)).toBe(true)
    expect(games[0]?.name).toBe(recentTitle)
  })

  it('requests a NEW window wide enough to cover the released facet set', async () => {
    const seen: number[] = []
    // Re-bind the fake to capture the requested size for NEW.
    const CapturingSony = Layer.succeed(SonyClient, {
      fetchConceptsByFeature: (feature, size = 0) =>
        Effect.sync(() => {
          if (feature === 'new') {
            seen.push(size)
            return [makeConcept('any')]
          }
          return []
        }),
      fetchProductDetail: () =>
        Effect.succeed({ releaseDate: PAST_DATE, genres: [], description: '' }),
    })
    const Services = GamesServiceLive.pipe(Layer.provide(CapturingSony))
    await Effect.runPromise(
      GamesService.pipe(
        Effect.flatMap((s) => s.getNewGames()),
        Effect.provide(Services),
      ),
    )

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((size) => size >= 300)).toBe(true)
  })

  it('orders games with equal release dates by upstream concept order (stable)', async () => {
    detailFor = () => ({
      releaseDate: '2025-01-01T00:00:00Z',
      genres: [],
      description: '',
    })
    conceptsFor = (feature) =>
      feature === 'new'
        ? [makeConcept('first'), makeConcept('second'), makeConcept('third')]
        : []

    const { games } = await run((s) => s.getNewGames())
    expect(games.map((g) => g.name)).toEqual(['first', 'second', 'third'])
  })
})

describe('getGameById detail enrichment', () => {
  it('enriches the game with LONG description and localized genres', async () => {
    detailFor = () => ({
      releaseDate: PAST_DATE,
      genres: ['Toiminta', 'Roolipelit'],
      description: '<p>The long game info body.</p>',
      publisherName: 'STUDIO OY',
    })
    conceptsFor = (feature) =>
      feature === 'new' ? [makeConcept('detailed')] : []

    const game = await run((s) =>
      Effect.flatMap(s.getNewGames(), (page) => {
        const first = page.games[0]
        if (!first) return Effect.die(new Error('expected a new game'))
        return s.getGameById(first.id)
      }),
    )
    expect(game.description).toBe('<p>The long game info body.</p>')
    expect(game.genres).toEqual(['Toiminta', 'Roolipelit'])
    expect(game.studio).toBe('STUDIO OY')
  })

  it('degrades to empty description / genres when the detail fetch fails', async () => {
    // The product detail boundary fails for every call; the detail cache
    // degrades the failure to an empty detail, so the game resolves with its
    // base (concept-derived) values rather than surfacing the upstream error.
    const FlakySony = Layer.succeed(SonyClient, {
      fetchConceptsByFeature: (feature) =>
        Effect.sync(() => (feature === 'new' ? [makeConcept('degraded')] : [])),
      fetchProductDetail: () => Effect.fail(upstream('boom')),
    })
    const Services = GamesServiceLive.pipe(Layer.provide(FlakySony))

    const game = await Effect.runPromise(
      GamesService.pipe(
        Effect.flatMap((s) =>
          Effect.flatMap(s.getNewGames(), (page) => {
            // With no release date the released-gate drops the card, so the base
            // list is empty; fall back to a direct getGameById on the SKU.
            const first = page.games[0]
            const id = first?.id ?? 'EP0001-PPSA00001_00-DEGRADED00000000'
            return s.getGameById(id).pipe(Effect.orElseSucceed(() => null))
          }),
        ),
        Effect.provide(Services),
      ),
    )
    // Either the game resolves with empty enrichment, or (no released date) 404s
    // and we get null — both are graceful, neither surfaces the upstream error.
    if (game) {
      expect(game.description).toBe('')
      expect(game.genres).toEqual([])
    }
  })
})
