import { Effect, Exit, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { UpstreamUnavailable } from '../errors/errors.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import { SonyClient, type ProductDetailResult } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

// NEW and UPCOMING read both Sony grids and classify each game by its product
// release date. The server lists are supersets of the client's local-day
// split: NEW ends 37 hours after now, UPCOMING starts 12 hours before now
// (25 hours to the latest local midnight plus a 12-hour clock margin).

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-05T12:00:00Z')
const at = (offsetHours: number): string =>
  new Date(NOW + offsetHours * HOUR).toISOString()

const product = (name: string, index: number): Concept => ({
  id: String(10_000 + index),
  name,
  media: [],
  price: {
    basePrice: '€29,95',
    discountedPrice: '€29,95',
    discountText: null,
    serviceBranding: ['NONE'],
    upsellServiceBranding: ['NONE'],
  },
  products: [
    {
      id: `EP0001-PPSA${String(index).padStart(5, '0')}_00-${name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .padEnd(16, '0')
        .slice(0, 16)}`,
    },
  ],
})

const conceptOnly = (name: string, id: string): Concept => ({
  id,
  name,
  media: [],
  price: undefined,
  products: [],
})

const productId = (concept: Concept): string => concept.products?.[0]?.id ?? ''

interface Grids {
  readonly released: Concept[] | 'fail'
  readonly upcoming: Concept[] | 'fail'
}

const run = <A, E>(
  grids: Grids,
  dates: ReadonlyMap<string, string>,
  use: (svc: GamesServiceApi) => Effect.Effect<A, E>,
) => {
  const grid = (value: Concept[] | 'fail') =>
    value === 'fail'
      ? Effect.fail(new UpstreamUnavailable({ message: 'down' }))
      : Effect.succeed(value)
  const Sony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: (feature) =>
      feature === 'new'
        ? grid(grids.released)
        : feature === 'upcoming'
          ? grid(grids.upcoming)
          : Effect.succeed([]),
    fetchProductDetail: (id) => {
      const releaseDate = dates.get(id)
      return Effect.succeed<ProductDetailResult>({
        ...(releaseDate === undefined ? {} : { releaseDate }),
        media: [],
        genres: [],
        description: '',
        storeDisplayClassification: 'FULL_GAME',
      })
    },
    fetchPlusMonthly: () => Effect.succeed([]),
    fetchSearchPage: () =>
      Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
    fetchBrowsePage: () => Effect.succeed({ concepts: [], isLast: true }),
    fetchGenres: () => Effect.succeed([]),
    fetchProductPrice: () =>
      Effect.succeed({ plusOffer: null, standard: null }),
  })
  return Effect.runPromiseExit(
    TestClock.setTime(NOW).pipe(
      Effect.andThen(GamesService),
      Effect.flatMap(use),
      Effect.provide(GamesServiceLive.pipe(Layer.provide(Sony))),
      Effect.provide(TestClock.layer()),
    ),
  )
}

const names = async (
  grids: Grids,
  dates: ReadonlyMap<string, string>,
  feature: 'new' | 'upcoming',
): Promise<string[]> => {
  const exit = await run(grids, dates, (s) =>
    feature === 'new' ? s.getNewGames(0, 120) : s.getUpcomingGames(0, 120),
  )
  if (Exit.isFailure(exit)) {
    throw new Error('expected a list')
  }
  return exit.value.games.map((game) => game.name)
}

describe('NEW / UPCOMING release split', () => {
  it('shows in NEW a released product that Sony files in the upcoming grid', async () => {
    // Live 2026-10-05: MXGP 26 (product date 2026-09-28) was only in the
    // `next_thirty_days` grid.
    const released = product('released-elsewhere', 1)
    const grids = { released: [], upcoming: [released] }
    const dates = new Map([[productId(released), at(-7 * 24)]])

    expect(await names(grids, dates, 'new')).toEqual(['released-elsewhere'])
    expect(await names(grids, dates, 'upcoming')).toEqual([])
  })

  it('shows in UPCOMING a future product that Sony files in the released grid', async () => {
    const future = product('future-elsewhere', 2)
    const grids = { released: [future], upcoming: [] }
    const dates = new Map([[productId(future), at(5 * 24)]])

    expect(await names(grids, dates, 'new')).toEqual([])
    expect(await names(grids, dates, 'upcoming')).toEqual(['future-elsewhere'])
  })

  it('sends a game near the day boundary to both lists, and others to one', async () => {
    const old = product('old', 3)
    const justOut = product('just-out', 4)
    const laterToday = product('later-today', 5)
    const edgeNew = product('edge-new', 6)
    const edgeUpcoming = product('edge-upcoming', 7)
    const farFuture = product('far-future', 8)
    const grids = {
      released: [old, justOut],
      upcoming: [laterToday, edgeNew, edgeUpcoming, farFuture],
    }
    const dates = new Map([
      [productId(old), at(-12 - 1 / 60)],
      [productId(justOut), at(-12)],
      [productId(laterToday), at(6)],
      [productId(edgeNew), at(37 - 1 / 60)],
      [productId(edgeUpcoming), at(37)],
      [productId(farFuture), at(10 * 24)],
    ])

    expect(await names(grids, dates, 'new')).toEqual([
      'edge-new',
      'later-today',
      'just-out',
      'old',
    ])
    expect(await names(grids, dates, 'upcoming')).toEqual([
      'just-out',
      'later-today',
      'edge-new',
      'edge-upcoming',
      'far-future',
    ])
  })

  it('keeps undated games out of NEW and at the end of UPCOMING', async () => {
    const dated = product('dated', 9)
    const undatedProduct = product('undated-product', 10)
    const announcement = conceptOnly('announcement', '10019999')
    const grids = {
      released: [],
      upcoming: [announcement, undatedProduct, dated],
    }
    const dates = new Map([[productId(dated), at(3 * 24)]])

    expect(await names(grids, dates, 'new')).toEqual([])
    expect(await names(grids, dates, 'upcoming')).toEqual([
      'dated',
      'announcement',
      'undated-product',
    ])
  })

  it('drops an undated product of the released grid, not shown as upcoming', async () => {
    // A failed detail lookup leaves a product without a date for the 6-hour
    // detail TTL. The released grid holds released games, so such a product
    // must not appear in UPCOMING. The valid products stay.
    const dated = product('dated-released', 13)
    const undated = product('released-detail-fails', 14)
    const upcoming = product('dated-upcoming', 15)
    const grids = { released: [dated, undated], upcoming: [upcoming] }
    const dates = new Map([
      [productId(dated), at(-24)],
      [productId(upcoming), at(5 * 24)],
    ])

    expect(await names(grids, dates, 'new')).toEqual(['dated-released'])
    expect(await names(grids, dates, 'upcoming')).toEqual(['dated-upcoming'])
  })

  it('drops a concept-only entry of the released grid, as before', async () => {
    const grids = {
      released: [conceptOnly('released-concept', '10018888')],
      upcoming: [],
    }

    expect(await names(grids, new Map(), 'new')).toEqual([])
    expect(await names(grids, new Map(), 'upcoming')).toEqual([])
  })

  it('shows a product in both grids once', async () => {
    const twin = product('twin', 11)
    const grids = { released: [twin], upcoming: [twin] }
    const dates = new Map([[productId(twin), at(-24)]])

    expect(await names(grids, dates, 'new')).toEqual(['twin'])
  })

  for (const failing of ['released', 'upcoming'] as const) {
    for (const feature of ['new', 'upcoming'] as const) {
      it(`${feature} fails when the ${failing} grid fails (no partial list)`, async () => {
        const ok = [product('ok', 12)]
        const grids: Grids =
          failing === 'released'
            ? { released: 'fail', upcoming: ok }
            : { released: ok, upcoming: 'fail' }
        const exit = await run(grids, new Map(), (s) =>
          feature === 'new' ? s.getNewGames() : s.getUpcomingGames(),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(JSON.stringify(exit.cause)).toContain('UpstreamUnavailable')
        }
      })
    }
  }
})
