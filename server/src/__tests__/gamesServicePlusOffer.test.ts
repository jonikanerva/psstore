import type { PlusOffer } from '@psstore/shared'
import { Duration, Effect, Layer, Logger } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { UpstreamUnavailable } from '../errors/errors.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import { SonyClient } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

const SKU = 'EP0001-PPSA00001_00-PLUSOFFER0000000'
const OTHER_SKU = 'EP0001-PPSA00002_00-PLUSOFFER0000001'

const concept = (sku: string, name: string): Concept => ({
  id: sku,
  name,
  media: [{ type: 'IMAGE', role: 'MASTER', url: `https://img/${name}` }],
  price: {
    basePrice: '€29,95',
    discountedPrice: '€29,95',
    discountText: null,
    serviceBranding: ['NONE'],
    upsellServiceBranding: ['NONE'],
  },
  products: [{ id: sku }],
})

type PriceResult = Effect.Effect<PlusOffer | null, UpstreamUnavailable>

interface Harness {
  readonly priceCalls: string[]
  readonly logs: string[]
  readonly run: <A, E>(
    use: (svc: GamesServiceApi) => Effect.Effect<A, E>,
  ) => Promise<A>
}

const harness = (price: (productId: string) => PriceResult): Harness => {
  const priceCalls: string[] = []
  const logs: string[] = []
  const Sony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: () =>
      Effect.succeed([concept(SKU, 'alpha'), concept(OTHER_SKU, 'bravo')]),
    fetchProductDetail: () =>
      Effect.succeed({
        releaseDate: '2025-01-01T00:00:00Z',
        genres: [],
        description: '',
        storeDisplayClassification: 'FULL_GAME',
      }),
    fetchPlusMonthly: () => Effect.succeed([]),
    fetchProductPrice: (productId) =>
      Effect.suspend(() => {
        priceCalls.push(productId)
        return price(productId)
      }),
  })
  const capture = Logger.make(({ logLevel, message }) => {
    logs.push(`${logLevel} ${JSON.stringify(message)}`)
  })
  const Services = GamesServiceLive.pipe(Layer.provide(Sony))
  return {
    priceCalls,
    logs,
    run: (use) =>
      Effect.runPromise(
        GamesService.pipe(
          Effect.flatMap(use),
          Effect.provide(Services),
          Effect.provide(Logger.layer([capture])),
          Effect.provide(TestClock.layer()),
        ),
      ),
  }
}

describe('PS Plus offer on the game page', () => {
  it('attaches the offer to the game page payload', async () => {
    const h = harness(() => Effect.succeed({ kind: 'price', price: '€24,95' }))
    const game = await h.run((s) => s.getGameById(SKU))
    expect(game.plusOffer).toEqual({ kind: 'price', price: '€24,95' })
  })

  it('never calls the price operation from list endpoints', async () => {
    const h = harness(() => Effect.succeed({ kind: 'included' }))
    await h.run((s) =>
      Effect.gen(function* () {
        yield* s.getNewGames()
        yield* s.getUpcomingGames()
        yield* s.getDiscountedGames()
      }),
    )
    expect(h.priceCalls).toEqual([])
  })

  it('leaves list games without an offer', async () => {
    const h = harness(() => Effect.succeed({ kind: 'included' }))
    const page = await h.run((s) => s.getNewGames())
    expect(page.games.length).toBeGreaterThan(0)
    expect(page.games.every((game) => game.plusOffer === null)).toBe(true)
  })

  it('degrades to a null offer and logs only the error tag on failure', async () => {
    const h = harness(() =>
      Effect.fail(new UpstreamUnavailable({ message: 'secret detail' })),
    )
    const game = await h.run((s) => s.getGameById(SKU))
    expect(game.plusOffer).toBeNull()
    expect(game.id).toBe(SKU)
    const warning = h.logs.find((line) =>
      line.includes('plus offer lookup failed'),
    )
    expect(warning).toContain('UpstreamUnavailable')
    expect(warning).not.toContain('secret detail')
  })

  it('caches a success for 10 minutes', async () => {
    const h = harness(() => Effect.succeed({ kind: 'included' }))
    await h.run((s) =>
      Effect.gen(function* () {
        yield* s.getGameById(SKU)
        yield* s.getGameById(SKU)
        expect(h.priceCalls).toHaveLength(1)

        yield* TestClock.adjust(
          Duration.minutes(10).pipe(Duration.subtract(Duration.millis(1))),
        )
        yield* s.getGameById(SKU)
        expect(h.priceCalls).toHaveLength(1)

        yield* TestClock.adjust(Duration.millis(1))
        yield* s.getGameById(SKU)
        expect(h.priceCalls).toHaveLength(2)
      }),
    )
  })

  it('caches a failure for 30 seconds, then retries', async () => {
    let failing = true
    const h = harness(() =>
      failing
        ? Effect.fail(new UpstreamUnavailable({ message: 'down' }))
        : Effect.succeed({ kind: 'included' }),
    )
    await h.run((s) =>
      Effect.gen(function* () {
        const first = yield* s.getGameById(SKU)
        expect(first.plusOffer).toBeNull()
        failing = false

        yield* TestClock.adjust(
          Duration.seconds(30).pipe(Duration.subtract(Duration.millis(1))),
        )
        const pinned = yield* s.getGameById(SKU)
        expect(pinned.plusOffer).toBeNull()
        expect(h.priceCalls).toHaveLength(1)

        yield* TestClock.adjust(Duration.millis(1))
        const recovered = yield* s.getGameById(SKU)
        expect(recovered.plusOffer).toEqual({ kind: 'included' })
        expect(h.priceCalls).toHaveLength(2)
      }),
    )
  })
})
