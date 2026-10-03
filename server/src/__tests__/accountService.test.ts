import { Deferred, Effect, Exit, Fiber, Layer, Redacted } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  SessionRejected,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import {
  AccountService,
  AccountServiceLive,
} from '../services/accountService.js'
import type { GamesServiceApi } from '../services/gamesService.js'
import { fakeGamesLayer } from './fakeGames.js'
import {
  SonyAccountClient,
  type SonyAccountClientApi,
} from '../sony/sonyClient.js'

const entry = {
  productId: 'EP0001-PPSA00001_00-SYNTHETICALPHA00',
  name: 'Synthetic Alpha',
  imageUrl: 'https://img.test/alpha.png',
}

const wishlistEntry = {
  id: '10000002',
  idKind: 'concept' as const,
  name: 'Synthetic Wish',
  imageUrl: 'https://img.test/wish.png',
}

const run = <A, E>(
  overrides: Partial<SonyAccountClientApi>,
  use: (service: AccountService['Service']) => Effect.Effect<A, E>,
  games: Partial<GamesServiceApi> = {},
) => {
  const exchange = vi.fn()
  const sony: SonyAccountClientApi = {
    exchangeNpsso: () => {
      exchange()
      return Effect.succeed(Redacted.make('synthetic-token'))
    },
    fetchPurchasedGames: () => Effect.succeed([entry]),
    fetchWishlistGames: () => Effect.succeed([wishlistEntry]),
    ...overrides,
  }
  const layer = AccountServiceLive.pipe(
    Layer.provide([
      Layer.succeed(SonyAccountClient, sony),
      fakeGamesLayer(games),
    ]),
  )
  return {
    exchange,
    exit: Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* use(yield* AccountService)
      }).pipe(Effect.provide(layer)),
    ),
  }
}

const npsso = Redacted.make('synthetic-npsso-0123456789')

describe('AccountService', () => {
  it('returns the whole library as one page', async () => {
    const { exit } = run({}, (service) => service.getPurchasedGames(npsso))
    const result = await exit
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.totalCount).toBe(1)
      expect(result.value.nextOffset).toBeNull()
      expect(result.value.games[0]?.name).toBe('Synthetic Alpha')
    }
  })

  it('returns an empty page for an empty library', async () => {
    const { exit } = run(
      { fetchPurchasedGames: () => Effect.succeed([]) },
      (service) => service.getPurchasedGames(npsso),
    )
    const result = await exit
    expect(Exit.isSuccess(result) && result.value.games).toEqual([])
  })

  it('passes each Sony failure through unchanged', async () => {
    const failures = [
      new SessionRejected({ message: 'no' }),
      new UpstreamRateLimited({ message: 'slow' }),
      new UpstreamUnavailable({ message: 'down' }),
    ]
    for (const failure of failures) {
      const { exit } = run(
        { exchangeNpsso: () => Effect.fail(failure) },
        (service) => service.getPurchasedGames(npsso),
      )
      const result = await exit
      expect(Exit.isFailure(result)).toBe(true)
      expect(JSON.stringify(result)).toContain(failure._tag)
    }
  })

  it('returns the whole wishlist as one page', async () => {
    const { exit } = run({}, (service) => service.getWishlistGames(npsso))
    const result = await exit
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.totalCount).toBe(1)
      expect(result.value.nextOffset).toBeNull()
      expect(result.value.games[0]).toMatchObject({
        id: '10000002',
        idKind: 'concept',
        name: 'Synthetic Wish',
        price: '',
      })
    }
  })

  it('returns an empty page for an empty wishlist', async () => {
    const { exit } = run(
      { fetchWishlistGames: () => Effect.succeed([]) },
      (service) => service.getWishlistGames(npsso),
    )
    const result = await exit
    expect(Exit.isSuccess(result) && result.value.games).toEqual([])
  })

  it('passes each wishlist failure through and skips the call after a failed exchange', async () => {
    const wishlist = vi.fn()
    const { exit } = run(
      {
        exchangeNpsso: () =>
          Effect.fail(new SessionRejected({ message: 'no' })),
        fetchWishlistGames: () => {
          wishlist()
          return Effect.succeed([])
        },
      },
      (service) => service.getWishlistGames(npsso),
    )
    expect(JSON.stringify(await exit)).toContain('SessionRejected')
    expect(wishlist).not.toHaveBeenCalled()
    for (const failure of [
      new SessionRejected({ message: 'no' }),
      new UpstreamRateLimited({ message: 'slow' }),
      new UpstreamUnavailable({ message: 'down' }),
    ]) {
      const failed = run(
        { fetchWishlistGames: () => Effect.fail(failure) },
        (service) => service.getWishlistGames(npsso),
      )
      expect(JSON.stringify(await failed.exit)).toContain(failure._tag)
    }
  })

  it('does not call the library when the exchange fails', async () => {
    const library = vi.fn()
    const { exit } = run(
      {
        exchangeNpsso: () =>
          Effect.fail(new SessionRejected({ message: 'no' })),
        fetchPurchasedGames: () => {
          library()
          return Effect.succeed([])
        },
      },
      (service) => service.getPurchasedGames(npsso),
    )
    await exit
    expect(library).not.toHaveBeenCalled()
  })

  it('exchanges the NPSSO again for each sequential call', async () => {
    const { exchange, exit } = run({}, (service) =>
      Effect.gen(function* () {
        yield* service.getPurchasedGames(npsso)
        yield* service.getPurchasedGames(npsso)
        yield* service.verifyNpsso(npsso)
      }),
    )
    await exit
    expect(exchange).toHaveBeenCalledTimes(3)
  })

  it('verifies the NPSSO without returning the token', async () => {
    const { exit } = run({}, (service) => service.verifyNpsso(npsso))
    const result = await exit
    expect(Exit.isSuccess(result) && result.value).toBeUndefined()
  })
})

const settle = Effect.forEach(
  Array.from({ length: 30 }, (_, index) => index),
  () => Effect.yieldNow,
  { discard: true },
)

const sameValueNpsso = () => Redacted.make('synthetic-npsso-0123456789')

describe('AccountService in-flight sharing', () => {
  const harness = (
    exchangeFor: (
      calls: number,
      npsso: Redacted.Redacted,
    ) => Effect.Effect<
      Redacted.Redacted,
      SessionRejected | UpstreamUnavailable
    >,
    fetchGames: SonyAccountClientApi['fetchPurchasedGames'] = () =>
      Effect.succeed([entry]),
  ) => {
    let calls = 0
    const sony: SonyAccountClientApi = {
      exchangeNpsso: (value) => {
        calls += 1
        return exchangeFor(calls, value)
      },
      fetchPurchasedGames: fetchGames,
      fetchWishlistGames: () => Effect.succeed([]),
    }
    const layer = AccountServiceLive.pipe(
      Layer.provide([Layer.succeed(SonyAccountClient, sony), fakeGamesLayer()]),
    )
    return {
      calls: () => calls,
      run: <A, E>(
        use: (service: AccountService['Service']) => Effect.Effect<A, E>,
      ) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* use(yield* AccountService)
          }).pipe(Effect.provide(layer)),
        ),
    }
  }

  it('shares one exchange between concurrent calls with equal NPSSO values', async () => {
    const gate = Deferred.makeUnsafe<null>()
    const h = harness(() =>
      Effect.gen(function* () {
        yield* Deferred.await(gate)
        return Redacted.make('synthetic-token')
      }),
    )
    await h.run((service) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          service.getPurchasedGames(sameValueNpsso()),
        )
        const second = yield* Effect.forkChild(
          service.verifyNpsso(sameValueNpsso()),
        )
        yield* settle
        expect(h.calls()).toBe(1)
        yield* Deferred.succeed(gate, null)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    )
    expect(h.calls()).toBe(1)
  })

  it('exchanges separately for different NPSSO values', async () => {
    const gate = Deferred.makeUnsafe<null>()
    const h = harness(() =>
      Effect.gen(function* () {
        yield* Deferred.await(gate)
        return Redacted.make('synthetic-token')
      }),
    )
    await h.run((service) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          service.verifyNpsso(Redacted.make('synthetic-npsso-aaaaaaaaaa')),
        )
        const second = yield* Effect.forkChild(
          service.verifyNpsso(Redacted.make('synthetic-npsso-bbbbbbbbbb')),
        )
        yield* settle
        expect(h.calls()).toBe(2)
        yield* Deferred.succeed(gate, null)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    )
  })

  it('exchanges anew after the earlier exchange completed', async () => {
    const h = harness(() => Effect.succeed(Redacted.make('synthetic-token')))
    await h.run((service) =>
      Effect.gen(function* () {
        yield* service.verifyNpsso(sameValueNpsso())
        yield* service.verifyNpsso(sameValueNpsso())
      }),
    )
    expect(h.calls()).toBe(2)
  })

  it('shares a failing exchange, then retries on a later call', async () => {
    const gate = Deferred.makeUnsafe<null>()
    const h = harness((calls) =>
      Effect.gen(function* () {
        if (calls === 1) {
          yield* Deferred.await(gate)
          return yield* new UpstreamUnavailable({ message: 'down' })
        }
        return Redacted.make('synthetic-token')
      }),
    )
    await h.run((service) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          Effect.exit(service.verifyNpsso(sameValueNpsso())),
        )
        const second = yield* Effect.forkChild(
          Effect.exit(service.verifyNpsso(sameValueNpsso())),
        )
        yield* settle
        yield* Deferred.succeed(gate, null)
        const exits = [yield* Fiber.join(first), yield* Fiber.join(second)]
        expect(exits.every(Exit.isFailure)).toBe(true)
        expect(h.calls()).toBe(1)
        yield* service.verifyNpsso(sameValueNpsso())
        expect(h.calls()).toBe(2)
      }),
    )
  })

  it('lets the other waiter succeed when one waiter is interrupted', async () => {
    const gate = Deferred.makeUnsafe<null>()
    const h = harness(() =>
      Effect.gen(function* () {
        yield* Deferred.await(gate)
        return Redacted.make('synthetic-token')
      }),
    )
    await h.run((service) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          service.verifyNpsso(sameValueNpsso()),
        )
        const second = yield* Effect.forkChild(
          service.verifyNpsso(sameValueNpsso()),
        )
        yield* settle
        yield* Fiber.interrupt(first)
        yield* Deferred.succeed(gate, null)
        const exit = yield* Fiber.await(second)
        expect(Exit.isSuccess(exit)).toBe(true)
        expect(h.calls()).toBe(1)
      }),
    )
  })

  it('interrupts the exchange when every waiter is interrupted', async () => {
    let interrupted = false
    const h = harness(() =>
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true
          }),
        ),
      ),
    )
    await h.run((service) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          service.verifyNpsso(sameValueNpsso()),
        )
        const second = yield* Effect.forkChild(
          service.verifyNpsso(sameValueNpsso()),
        )
        yield* settle
        yield* Fiber.interrupt(first)
        yield* settle
        expect(interrupted).toBe(false)
        yield* Fiber.interrupt(second)
        yield* settle
        expect(interrupted).toBe(true)
      }),
    )
  })

  it('closes the shared entry before the library crawl', async () => {
    const gate = Deferred.makeUnsafe<null>()
    const h = harness(
      () => Effect.succeed(Redacted.make('synthetic-token')),
      () =>
        Effect.gen(function* () {
          yield* Deferred.await(gate)
          return [entry]
        }),
    )
    await h.run((service) =>
      Effect.gen(function* () {
        const crawl = yield* Effect.forkChild(
          service.getPurchasedGames(sameValueNpsso()),
        )
        yield* settle
        expect(h.calls()).toBe(1)
        yield* service.verifyNpsso(sameValueNpsso())
        expect(h.calls()).toBe(2)
        yield* Deferred.succeed(gate, null)
        yield* Fiber.join(crawl)
      }),
    )
  })
})
