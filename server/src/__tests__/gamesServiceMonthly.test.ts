import { Duration, Effect, Layer, Logger } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { GameNotFound, UpstreamUnavailable } from '../errors/errors.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import type { PlusMonthlyEntry } from '../sony/plusMonthlySchema.js'
import { SonyClient } from '../sony/sonyClient.js'

const entry = (productId: string, releaseDate: string): PlusMonthlyEntry => ({
  productId,
  name: productId,
  imageUrl: '',
  releaseDate,
  genres: [],
})

const OLD = entry(
  'UP0001-PPSA00001_00-OLD0000000000000',
  '2024-01-01T00:00:00Z',
)
const NEW = entry(
  'UP0001-PPSA00002_00-NEW0000000000000',
  '2026-01-01T00:00:00Z',
)

type MonthlyResult = Effect.Effect<
  readonly PlusMonthlyEntry[],
  UpstreamUnavailable
>

const harness = (
  monthly: () => MonthlyResult,
  opts: { priceFails?: boolean } = {},
) => {
  const counts = { monthly: 0, price: 0, list: 0 }
  const logs: string[] = []
  const Sony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: () =>
      Effect.sync(() => {
        counts.list += 1
        return []
      }),
    fetchProductDetail: () =>
      Effect.succeed({
        releaseDate: '2025-01-01T00:00:00Z',
        genres: ['Action'],
        description: 'long text',
      }),
    fetchPlusMonthly: () =>
      Effect.suspend(() => {
        counts.monthly += 1
        return monthly()
      }),
    fetchSearchPage: () =>
      Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
    fetchProductPrice: () =>
      Effect.suspend(() => {
        counts.price += 1
        return opts.priceFails === true
          ? Effect.fail(new UpstreamUnavailable({ message: 'price down' }))
          : Effect.succeed({ kind: 'included' as const })
      }),
  })
  const capture = Logger.make(({ logLevel, message }) => {
    logs.push(`${logLevel} ${JSON.stringify(message)}`)
  })
  const Services = GamesServiceLive.pipe(Layer.provide(Sony))
  const run = <A, E>(use: (svc: GamesServiceApi) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      GamesService.pipe(
        Effect.flatMap(use),
        Effect.provide(Services),
        Effect.provide(Logger.layer([capture])),
        Effect.provide(TestClock.layer()),
      ),
    )
  return { counts, logs, run }
}

describe('MONTHLY list in gamesService', () => {
  it('orders by release date and paginates', async () => {
    const h = harness(() => Effect.succeed([OLD, NEW]))
    const page = await h.run((s) => s.getMonthlyGames(0, 1))
    expect(page.games.map((game) => game.id)).toEqual([NEW.productId])
    expect(page.totalCount).toBe(2)
    expect(page.nextOffset).toBe(1)
  })

  it('does not enrich cards: no price lookup, no grid fetch', async () => {
    const h = harness(() => Effect.succeed([OLD, NEW]))
    await h.run((s) => s.getMonthlyGames())
    expect(h.counts.price).toBe(0)
    expect(h.counts.list).toBe(0)
  })

  it('caches the list for one hour', async () => {
    const h = harness(() => Effect.succeed([OLD]))
    await h.run((s) =>
      Effect.gen(function* () {
        yield* s.getMonthlyGames()
        yield* s.getMonthlyGames()
        expect(h.counts.monthly).toBe(1)

        yield* TestClock.adjust(
          Duration.hours(1).pipe(Duration.subtract(Duration.millis(1))),
        )
        yield* s.getMonthlyGames()
        expect(h.counts.monthly).toBe(1)

        yield* TestClock.adjust(Duration.millis(1))
        yield* s.getMonthlyGames()
        expect(h.counts.monthly).toBe(2)
      }),
    )
  })

  it('caches a failure for 30 seconds, then retries', async () => {
    let failing = true
    const h = harness(() =>
      failing
        ? Effect.fail(new UpstreamUnavailable({ message: 'down' }))
        : Effect.succeed([OLD]),
    )
    await h.run((s) =>
      Effect.gen(function* () {
        const first = yield* Effect.flip(s.getMonthlyGames())
        expect(first._tag).toBe('UpstreamUnavailable')
        failing = false

        yield* TestClock.adjust(
          Duration.seconds(30).pipe(Duration.subtract(Duration.millis(1))),
        )
        yield* Effect.flip(s.getMonthlyGames())
        expect(h.counts.monthly).toBe(1)

        yield* TestClock.adjust(Duration.millis(1))
        const page = yield* s.getMonthlyGames()
        expect(page.games).toHaveLength(1)
        expect(h.counts.monthly).toBe(2)
      }),
    )
  })

  it('resolves a monthly-only game on the game page with detail and price', async () => {
    const h = harness(() => Effect.succeed([OLD]))
    const game = await h.run((s) => s.getGameById(OLD.productId))
    expect(game.id).toBe(OLD.productId)
    expect(game.description).toBe('long text')
    expect(game.plusOffer).toEqual({ kind: 'included' })
  })

  it('still resolves the game page when the price lookup fails', async () => {
    const h = harness(() => Effect.succeed([OLD]), { priceFails: true })
    const game = await h.run((s) => s.getGameById(OLD.productId))
    expect(game.plusOffer).toBeNull()
  })

  it('answers 404 for an id in no list', async () => {
    const h = harness(() => Effect.succeed([OLD]))
    const error = await h.run((s) =>
      Effect.flip(s.getGameById('UP0001-PPSA09999_00-MISSING000000000')),
    )
    expect(error).toBeInstanceOf(GameNotFound)
  })
})
