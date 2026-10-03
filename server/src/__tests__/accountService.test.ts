import { Effect, Exit, Layer, Redacted } from 'effect'
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
import {
  SonyAccountClient,
  type SonyAccountClientApi,
} from '../sony/sonyClient.js'

const entry = {
  productId: 'EP0001-PPSA00001_00-SYNTHETICALPHA00',
  conceptId: null,
  name: 'Synthetic Alpha',
  imageUrl: 'https://img.test/alpha.png',
}

const run = <A, E>(
  overrides: Partial<SonyAccountClientApi>,
  use: (service: AccountService['Service']) => Effect.Effect<A, E>,
) => {
  const exchange = vi.fn()
  const sony: SonyAccountClientApi = {
    exchangeNpsso: () => {
      exchange()
      return Effect.succeed(Redacted.make('synthetic-token'))
    },
    fetchPurchasedGames: () => Effect.succeed([entry]),
    ...overrides,
  }
  const layer = AccountServiceLive.pipe(
    Layer.provide(Layer.succeed(SonyAccountClient, sony)),
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

  it('exchanges the NPSSO again on every call (no cache)', async () => {
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
