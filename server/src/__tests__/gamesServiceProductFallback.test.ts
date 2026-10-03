import { Duration, Effect, Exit, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import {
  GameNotFound,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import type { ProductPrice } from '../sony/productPriceSchema.js'
import { SonyClient, type ProductDetailResult } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

const ID = 'EP0002-PPSA02410_00-DESTINYTHEGAME02'
const LISTED_ID = 'EP0001-PPSA00001_00-LISTED0000000000'

type UpstreamFailure =
  UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited

const detail = (
  overrides: Partial<ProductDetailResult> = {},
): ProductDetailResult => ({
  name: 'Destiny 2',
  media: [
    { type: 'IMAGE', role: 'GAMEHUB_COVER_ART', url: 'https://img/cover' },
    { type: 'IMAGE', role: 'SCREENSHOT', url: 'https://img/shot1' },
    { type: 'IMAGE', role: 'SCREENSHOT', url: 'https://img/shot2' },
    { type: 'VIDEO', role: 'PREVIEW', url: 'https://vid/preview.mp4' },
  ],
  releaseDate: '2019-10-01T00:00:00Z',
  genres: ['Action', 'Shooter'],
  description: 'Long description',
  publisherName: 'Bungie',
  storeDisplayClassification: 'FULL_GAME',
  platforms: ['PS4', 'PS5'],
  ...overrides,
})

const price = (overrides: Partial<ProductPrice> = {}): ProductPrice => ({
  plusOffer: null,
  standard: {
    basePrice: '€39,99',
    discountedPrice: '€39,99',
    discountText: '',
  },
  ...overrides,
})

interface Calls {
  detail: number
  price: number
}

interface Behaviour {
  detail: () => Effect.Effect<ProductDetailResult, UpstreamFailure>
  price: () => Effect.Effect<ProductPrice, UpstreamFailure>
  listed?: Concept[]
}

const listedConcept: Concept = {
  id: '1',
  name: 'Listed',
  media: [],
  price: { basePrice: '€9,99', discountedPrice: '€9,99' },
  products: [{ id: LISTED_ID }],
}

const harness = (behaviour: Partial<Behaviour> = {}) => {
  const calls: Calls = { detail: 0, price: 0 }
  const Sony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: (feature) =>
      Effect.succeed(feature === 'new' ? (behaviour.listed ?? []) : []),
    fetchPlusMonthly: () => Effect.succeed([]),
    fetchSearchPage: () =>
      Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
    fetchProductDetail: () =>
      Effect.suspend(() => {
        calls.detail += 1
        return (behaviour.detail ?? (() => Effect.succeed(detail())))()
      }),
    fetchProductPrice: () =>
      Effect.suspend(() => {
        calls.price += 1
        return (behaviour.price ?? (() => Effect.succeed(price())))()
      }),
  })
  const Services = GamesServiceLive.pipe(Layer.provide(Sony))
  const runExit = <A, E>(use: (svc: GamesServiceApi) => Effect.Effect<A, E>) =>
    Effect.runPromiseExit(
      GamesService.pipe(
        Effect.flatMap(use),
        Effect.provide(Services),
        Effect.provide(TestClock.layer()),
      ),
    )
  return { calls, runExit }
}

const failureOf = <A, E>(exit: Exit.Exit<A, E>): unknown => {
  if (Exit.isSuccess(exit)) {
    throw new Error('expected a failure')
  }
  const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail')
  return failure?.error
}

const gameOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isFailure(exit)) {
    throw new Error(JSON.stringify(exit.cause))
  }
  return exit.value
}

describe('getGameById product-id fallback', () => {
  it('builds a full game from the product detail and price', async () => {
    const h = harness({
      price: () =>
        Effect.succeed(
          price({ plusOffer: { kind: 'price', price: '€34,99' } }),
        ),
    })
    const game = gameOf(await h.runExit((s) => s.getGameById(ID)))

    expect(game).toMatchObject({
      id: ID,
      name: 'Destiny 2',
      date: '2019-10-01T00:00:00.000Z',
      url: 'https://img/cover',
      price: '€39,99',
      originalPrice: '',
      discountText: '',
      screenshots: ['https://img/shot1', 'https://img/shot2'],
      videos: ['https://vid/preview.mp4'],
      genres: ['Action', 'Shooter'],
      studio: 'Bungie',
      description: 'Long description',
      plusOffer: { kind: 'price', price: '€34,99' },
      plusUpsellText: null,
      idKind: 'product',
      preOrder: false,
    })
  })

  it('keeps Sony discount strings for a standard sale', async () => {
    const h = harness({
      price: () =>
        Effect.succeed(
          price({
            standard: {
              basePrice: '€39,99',
              discountedPrice: '€19,99',
              discountText: '-50%',
            },
          }),
        ),
    })
    const game = gameOf(await h.runExit((s) => s.getGameById(ID)))

    expect(game.price).toBe('€19,99')
    expect(game.originalPrice).toBe('€39,99')
    expect(game.discountText).toBe('-50%')
  })

  it('shows a free game as Free without a discount', async () => {
    const h = harness({
      price: () =>
        Effect.succeed(
          price({
            standard: {
              basePrice: 'Free',
              discountedPrice: 'Free',
              discountText: '',
            },
          }),
        ),
    })
    const game = gameOf(await h.runExit((s) => s.getGameById(ID)))

    expect(game.price).toBe('Free')
    expect(game.originalPrice).toBe('')
    expect(game.discountText).toBe('')
  })

  it('returns a game with an empty price when Sony shows no standard price', async () => {
    const h = harness({
      price: () => Effect.succeed(price({ standard: null })),
    })
    const game = gameOf(await h.runExit((s) => s.getGameById(ID)))

    expect(game.price).toBe('')
    expect(game.name).toBe('Destiny 2')
  })

  it('accepts a cross-generation game', async () => {
    const h = harness({
      detail: () => Effect.succeed(detail({ platforms: ['PS4', 'PS5'] })),
    })
    const exit = await h.runExit((s) => s.getGameById(ID))

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it('answers GameNotFound for a PS4-only game', async () => {
    const h = harness({
      detail: () => Effect.succeed(detail({ platforms: ['PS4'] })),
    })
    const error = failureOf(await h.runExit((s) => s.getGameById(ID)))

    expect(error).toBeInstanceOf(GameNotFound)
  })

  it('answers GameNotFound for a DLC classification', async () => {
    const h = harness({
      detail: () =>
        Effect.succeed(
          detail({ storeDisplayClassification: 'PREMIUM_EDITION' }),
        ),
    })
    const error = failureOf(await h.runExit((s) => s.getGameById(ID)))

    expect(error).toBeInstanceOf(GameNotFound)
  })

  it('answers GameNotFound when Sony has no data for the id', async () => {
    const h = harness({
      detail: () =>
        Effect.succeed({
          media: [],
          genres: [],
          description: '',
          platforms: [],
        }),
    })
    const error = failureOf(await h.runExit((s) => s.getGameById(ID)))

    expect(error).toBeInstanceOf(GameNotFound)
  })

  it('fails with UpstreamUnavailable for PS5 data without a name', async () => {
    const h = harness({
      detail: () => Effect.succeed(detail({ name: undefined })),
    })
    const error = failureOf(await h.runExit((s) => s.getGameById(ID)))

    expect(error).toBeInstanceOf(UpstreamUnavailable)
  })

  it('answers GameNotFound for an invalid id without any Sony call', async () => {
    const h = harness()
    const error = failureOf(
      await h.runExit((s) => s.getGameById('not-a-product-id')),
    )

    expect(error).toBeInstanceOf(GameNotFound)
    expect(h.calls).toEqual({ detail: 0, price: 0 })
  })

  it.each([
    ['UpstreamUnavailable', new UpstreamUnavailable({ message: 'down' })],
    [
      'UpstreamQueryRotated',
      new UpstreamQueryRotated({ message: 'rotated', operationName: 'op' }),
    ],
    ['UpstreamRateLimited', new UpstreamRateLimited({ message: 'slow' })],
  ])('propagates a %s detail failure instead of GameNotFound', async (_, e) => {
    const h = harness({ detail: () => Effect.fail(e) })
    const error = failureOf(await h.runExit((s) => s.getGameById(ID)))

    expect(error).toBe(e)
    expect(error).not.toBeInstanceOf(GameNotFound)
  })

  it('returns the game without a price when the price lookup fails', async () => {
    const h = harness({
      price: () => Effect.fail(new UpstreamUnavailable({ message: 'down' })),
    })
    const game = gameOf(await h.runExit((s) => s.getGameById(ID)))

    expect(game.name).toBe('Destiny 2')
    expect(game.price).toBe('')
    expect(game.plusOffer).toBeNull()
  })

  it('does not use the fallback for an id that a list contains', async () => {
    const h = harness({ listed: [listedConcept] })
    const game = gameOf(await h.runExit((s) => s.getGameById(LISTED_ID)))

    expect(game.name).toBe('Listed')
    expect(h.calls.detail).toBe(1)
  })
})

describe('product-id fallback cache TTL (TestClock)', () => {
  const FAILURE_MS = 30_000
  const MISS_MS = 5 * 60 * 1000
  const HIT_MS = 6 * 60 * 60 * 1000

  it('retries a failed detail lookup after 30 seconds', async () => {
    let attempt = 0
    const h = harness({
      detail: () =>
        ++attempt === 1
          ? Effect.fail(new UpstreamUnavailable({ message: 'down' }))
          : Effect.succeed(detail()),
    })
    const exit = await h.runExit((s) =>
      Effect.gen(function* () {
        const first = yield* Effect.exit(s.getGameById(ID))
        yield* TestClock.adjust(Duration.millis(FAILURE_MS - 1))
        const pinned = yield* Effect.exit(s.getGameById(ID))
        yield* TestClock.adjust(Duration.millis(1))
        const retried = yield* Effect.exit(s.getGameById(ID))
        return [first, pinned, retried] as const
      }),
    )
    const [first, pinned, retried] = gameOf(exit)

    expect(Exit.isFailure(first)).toBe(true)
    expect(Exit.isFailure(pinned)).toBe(true)
    expect(Exit.isSuccess(retried)).toBe(true)
    expect(h.calls.detail).toBe(2)
  })

  it('caches a miss for 5 minutes', async () => {
    const h = harness({
      detail: () =>
        Effect.succeed({
          media: [],
          genres: [],
          description: '',
          platforms: [],
        }),
    })
    await h.runExit((s) =>
      Effect.gen(function* () {
        yield* Effect.exit(s.getGameById(ID))
        yield* TestClock.adjust(Duration.millis(MISS_MS - 1))
        yield* Effect.exit(s.getGameById(ID))
        expect(h.calls.detail).toBe(1)
        yield* TestClock.adjust(Duration.millis(1))
        yield* Effect.exit(s.getGameById(ID))
        expect(h.calls.detail).toBe(2)
      }),
    )
  })

  it('caches a hit for 6 hours', async () => {
    const h = harness()
    await h.runExit((s) =>
      Effect.gen(function* () {
        yield* s.getGameById(ID)
        yield* TestClock.adjust(Duration.millis(HIT_MS - 1))
        yield* s.getGameById(ID)
        expect(h.calls.detail).toBe(1)
        yield* TestClock.adjust(Duration.millis(1))
        yield* s.getGameById(ID)
        expect(h.calls.detail).toBe(2)
      }),
    )
  })
})
