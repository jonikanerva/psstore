import type { Game } from '@psstore/shared'
import { Duration, Effect, Fiber, Layer, Logger, Redacted } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  WISHLIST_ENRICH_CONCURRENCY,
  WISHLIST_ENRICH_ENTRY_TIMEOUT_MS,
  WISHLIST_ENRICH_TOTAL_TIMEOUT_MS,
} from '../config/env.js'
import { GameNotFound, UpstreamUnavailable } from '../errors/errors.js'
import {
  AccountService,
  AccountServiceLive,
} from '../services/accountService.js'
import type { GamesServiceApi } from '../services/gamesService.js'
import { SonyAccountClient } from '../sony/sonyClient.js'
import type { WishlistEntry } from '../sony/wishlistSchema.js'
import { fakeGamesLayer } from './fakeGames.js'

const sku = (index: number): string =>
  `EP0001-PPSA${String(index).padStart(5, '0')}_00-SYNTHETIC${String(index).padStart(7, '0')}`

const entry = (index: number): WishlistEntry => ({
  id: sku(index),
  idKind: 'product',
  name: `Wish ${String(index)}`,
  imageUrl: `https://img.test/wish${String(index)}.png`,
})

const conceptEntry: WishlistEntry = {
  id: '10000002',
  idKind: 'concept',
  name: 'Wish Concept',
  imageUrl: 'https://img.test/concept.png',
}

const storeGame = (id: string): Game => ({
  id,
  name: `Store ${id}`,
  date: '2025-01-02T00:00:00.000Z',
  url: 'https://img.test/store.png',
  price: '€39,99',
  originalPrice: '€59,99',
  discountText: '-33%',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: ['Action'],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: { kind: 'price', price: '€29,99' },
  idKind: 'product',
})

const NPSSO = Redacted.make('synthetic-npsso-0123456789')

const harness = (
  entries: readonly WishlistEntry[],
  games: Partial<GamesServiceApi>,
) => {
  const logs: string[] = []
  const exchange = vi.fn()
  const fetchWishlist = vi.fn()
  const layer = AccountServiceLive.pipe(
    Layer.provide([
      Layer.succeed(SonyAccountClient, {
        exchangeNpsso: () => {
          exchange()
          return Effect.succeed(Redacted.make('synthetic-token'))
        },
        fetchPurchasedGames: () => Effect.succeed([]),
        fetchWishlistGames: () => {
          fetchWishlist()
          return Effect.succeed(entries)
        },
      }),
      fakeGamesLayer(games),
    ]),
    Layer.provideMerge(
      Logger.layer([
        Logger.make((options) => {
          logs.push(JSON.stringify([options.message]))
        }),
      ]),
    ),
  )
  // Runs the wishlist call under a test clock, advancing it by each step.
  const run = (...steps: readonly number[]) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* AccountService
        const fiber = yield* Effect.forkChild(service.getWishlistGames(NPSSO))
        for (const ms of steps) {
          yield* Effect.yieldNow
          yield* TestClock.adjust(Duration.millis(ms))
        }
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )
  return { run, logs, exchange, fetchWishlist }
}

describe('wishlist enrichment', () => {
  it('fills date, prices and the Plus offer from the public store, in order', async () => {
    const h = harness([entry(1), entry(2)], {
      getGameById: (id) => Effect.succeed(storeGame(id)),
    })
    const page = await h.run()
    expect(page.games.map((game) => game.id)).toEqual([sku(1), sku(2)])
    expect(page.games[0]).toMatchObject({
      price: '€39,99',
      originalPrice: '€59,99',
      discountText: '-33%',
      date: '2025-01-02T00:00:00.000Z',
      plusOffer: { kind: 'price', price: '€29,99' },
    })
    expect(page.totalCount).toBe(2)
    expect(page.nextOffset).toBeNull()
  })

  it('keeps a minimal card when the store has no such game', async () => {
    const h = harness([entry(1)], {
      getGameById: (id) => Effect.fail(new GameNotFound({ id })),
    })
    const page = await h.run()
    expect(page.games[0]).toMatchObject({
      id: sku(1),
      name: 'Wish 1',
      url: 'https://img.test/wish1.png',
      price: '',
      date: '',
      plusOffer: null,
    })
  })

  it('degrades only the entry whose lookup failed', async () => {
    const h = harness([entry(1), entry(2), entry(3)], {
      getGameById: (id) =>
        id === sku(2)
          ? Effect.fail(new UpstreamUnavailable({ message: 'down' }))
          : Effect.succeed(storeGame(id)),
    })
    const page = await h.run()
    expect(page.games.map((game) => game.price)).toEqual([
      '€39,99',
      '',
      '€39,99',
    ])
    expect(page.games[1]?.name).toBe('Wish 2')
  })

  it('degrades an entry whose lookup is slower than its deadline', async () => {
    const h = harness([entry(1), entry(2)], {
      getGameById: (id) =>
        id === sku(1) ? Effect.never : Effect.succeed(storeGame(id)),
    })
    const page = await h.run(WISHLIST_ENRICH_ENTRY_TIMEOUT_MS)
    expect(page.games.map((game) => game.price)).toEqual(['', '€39,99'])
  })

  it('falls back to minimal cards when the whole list runs past its deadline', async () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry(index + 1))
    const h = harness(entries, { getGameById: () => Effect.never })
    const page = await h.run(WISHLIST_ENRICH_TOTAL_TIMEOUT_MS)
    expect(page.games).toHaveLength(30)
    expect(page.games.every((game) => game.price === '')).toBe(true)
    expect(page.games[0]?.name).toBe('Wish 1')
  })

  it('never looks up a concept entry', async () => {
    const lookup = vi.fn()
    const h = harness([conceptEntry], {
      getGameById: (id) => {
        lookup(id)
        return Effect.succeed(storeGame(id))
      },
    })
    const page = await h.run()
    expect(lookup).not.toHaveBeenCalled()
    expect(page.games[0]).toMatchObject({
      id: '10000002',
      idKind: 'concept',
      price: '',
    })
  })

  it('runs a bounded number of lookups at once', async () => {
    let active = 0
    let peak = 0
    const entries = Array.from({ length: 20 }, (_, index) => entry(index + 1))
    const h = harness(entries, {
      getGameById: (id) =>
        Effect.gen(function* () {
          active += 1
          peak = Math.max(peak, active)
          yield* Effect.sleep(Duration.millis(100))
          active -= 1
          return storeGame(id)
        }),
    })
    const page = await h.run(100, 100, 100, 100)
    expect(page.games.every((game) => game.price === '€39,99')).toBe(true)
    expect(peak).toBe(WISHLIST_ENRICH_CONCURRENCY)
  })

  it('caches neither the wishlist nor the exchange between calls', async () => {
    const h = harness([entry(1)], {
      getGameById: (id) => Effect.succeed(storeGame(id)),
    })
    await h.run()
    await h.run()
    expect(h.fetchWishlist).toHaveBeenCalledTimes(2)
    expect(h.exchange).toHaveBeenCalledTimes(2)
  })

  it('logs counts only, never a name or an id', async () => {
    const h = harness([entry(1), conceptEntry], {
      getGameById: (id) => Effect.succeed(storeGame(id)),
    })
    await h.run()
    expect(h.logs.length).toBeGreaterThan(0)
    for (const line of h.logs) {
      expect(line).not.toContain('Wish')
      expect(line).not.toContain(sku(1))
      expect(line).not.toContain('10000002')
    }
  })
})
