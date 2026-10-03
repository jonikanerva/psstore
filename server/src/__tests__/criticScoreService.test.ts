import { Duration, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import type { CriticCandidate } from '../domain/criticMatch.js'
import {
  CriticSourceRejected,
  CriticSourceUnavailable,
} from '../errors/errors.js'
import { IgdbClient, type IgdbClientApi } from '../igdb/igdbClient.js'
import {
  CriticScoreService,
  CriticScoreServiceDisabled,
  CriticScoreServiceLive,
} from '../services/criticScoreService.js'

const game = {
  id: 'EP0001-PPSA00001_00-ALPHA00000000000',
  name: 'Synthetic Quest',
  date: '2023-11-14T00:00:00Z',
}
const rated: CriticCandidate = {
  name: 'Synthetic Quest',
  releaseYear: 2023,
  rating: 84,
  ratingCount: 12,
}

const run = <A>(
  igdb: IgdbClientApi,
  use: (service: typeof CriticScoreService.Service) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    CriticScoreService.pipe(
      Effect.flatMap(use),
      Effect.provide(
        CriticScoreServiceLive.pipe(
          Layer.provide(Layer.succeed(IgdbClient, igdb)),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  )

describe('CriticScoreService', () => {
  it('returns the matched score', async () => {
    const score = await run({ findGames: () => Effect.succeed([rated]) }, (s) =>
      s.scoreFor(game),
    )
    expect(score).toBe(84)
  })

  it('returns null on a miss', async () => {
    const score = await run({ findGames: () => Effect.succeed([]) }, (s) =>
      s.scoreFor(game),
    )
    expect(score).toBeNull()
  })

  it('returns null and skips the provider when the date is missing', async () => {
    let calls = 0
    const score = await run(
      {
        findGames: () =>
          Effect.sync(() => {
            calls += 1
            return [rated]
          }),
      },
      (s) => s.scoreFor({ ...game, date: '' }),
    )
    expect(score).toBeNull()
    expect(calls).toBe(0)
  })

  it.each([
    new CriticSourceUnavailable({ message: 'down' }),
    new CriticSourceRejected({ message: 'status 401' }),
  ])('degrades a provider failure to null (%s)', async (error) => {
    const score = await run({ findGames: () => Effect.fail(error) }, (s) =>
      s.scoreFor(game),
    )
    expect(score).toBeNull()
  })

  it('degrades a slow provider to null after the budget', async () => {
    const score = await run({ findGames: () => Effect.never }, (s) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(s.scoreFor(game))
        yield* TestClock.adjust(Duration.millis(1500))
        return yield* Fiber.join(fiber)
      }),
    )
    expect(score).toBeNull()
  })

  it('looks a game up once per day, for a hit and for a miss', async () => {
    let calls = 0
    const counted: IgdbClientApi = {
      findGames: () =>
        Effect.sync(() => {
          calls += 1
          return []
        }),
    }
    await run(counted, (s) =>
      Effect.gen(function* () {
        yield* s.scoreFor(game)
        yield* s.scoreFor(game)
        yield* TestClock.adjust(
          Duration.hours(24).pipe(Duration.subtract(Duration.millis(1))),
        )
        yield* s.scoreFor(game)
        expect(calls).toBe(1)
        yield* TestClock.adjust(Duration.millis(1))
        yield* s.scoreFor(game)
      }),
    )
    expect(calls).toBe(2)
  })

  it('retries a failed lookup after a short time', async () => {
    let calls = 0
    const flaky: IgdbClientApi = {
      findGames: () =>
        Effect.suspend(() => {
          calls += 1
          return calls === 1
            ? Effect.fail(new CriticSourceUnavailable({ message: 'down' }))
            : Effect.succeed([rated])
        }),
    }
    const scores = await run(flaky, (s) =>
      Effect.gen(function* () {
        const first = yield* s.scoreFor(game)
        const cached = yield* s.scoreFor(game)
        yield* TestClock.adjust(Duration.minutes(1))
        const retried = yield* s.scoreFor(game)
        return [first, cached, retried]
      }),
    )
    expect(scores).toEqual([null, null, 84])
    expect(calls).toBe(2)
  })

  it('is disabled without credentials', async () => {
    const score = await Effect.runPromise(
      CriticScoreService.pipe(
        Effect.flatMap((s) => s.scoreFor(game)),
        Effect.provide(CriticScoreServiceDisabled),
      ),
    )
    expect(score).toBeNull()
  })
})
