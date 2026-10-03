import type { Game } from '@psstore/shared'
import {
  Cache,
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
} from 'effect'
import { CRITIC_SCORE_BUDGET_MS } from '../config/env.js'
import { matchCriticScore, releaseYearOf } from '../domain/criticMatch.js'
import { CriticSourceUnavailable } from '../errors/errors.js'
import { IgdbClient, type IgdbError } from '../igdb/igdbClient.js'

export type CriticSubjectGame = Pick<Game, 'id' | 'name' | 'date'>

export interface CriticScoreServiceApi {
  // An integer 0 to 100, or null. Never fails: every failure is no score.
  readonly scoreFor: (game: CriticSubjectGame) => Effect.Effect<number | null>
}

export class CriticScoreService extends Context.Service<
  CriticScoreService,
  CriticScoreServiceApi
>()('CriticScoreService') {}

// Public data only: the Sony product id, title, and release year.
class CriticKey extends Data.Class<{
  readonly id: string
  readonly title: string
  readonly year: number
}> {}

const criticTtl = (
  exit: Exit.Exit<number | null, IgdbError>,
): Duration.Duration =>
  Exit.isSuccess(exit) ? Duration.hours(24) : Duration.minutes(1)

export const CriticScoreServiceLive: Layer.Layer<
  CriticScoreService,
  never,
  IgdbClient
> = Layer.effect(
  CriticScoreService,
  Effect.gen(function* () {
    const igdb = yield* IgdbClient

    const scoreCache = yield* Cache.makeWith<
      CriticKey,
      number | null,
      IgdbError
    >(
      (key) =>
        igdb.findGames(key.title, key.year).pipe(
          Effect.map((candidates) =>
            matchCriticScore(key.title, key.year, candidates),
          ),
          Effect.timeoutOption(Duration.millis(CRITIC_SCORE_BUDGET_MS)),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new CriticSourceUnavailable({ message: 'budget exceeded' }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      { capacity: 5_000, timeToLive: criticTtl },
    )

    const scoreFor: CriticScoreServiceApi['scoreFor'] = (game) => {
      const year = releaseYearOf(game.date)
      return year === null
        ? Effect.succeed(null)
        : Cache.get(
            scoreCache,
            new CriticKey({ id: game.id, title: game.name, year }),
          ).pipe(
            Effect.catch((error) =>
              Effect.logWarning('critic score lookup failed', {
                reason: error._tag,
              }).pipe(Effect.as(null)),
            ),
          )
    }

    return CriticScoreService.of({ scoreFor })
  }),
)

// Used when the provider credentials are absent.
export const CriticScoreServiceDisabled: Layer.Layer<CriticScoreService> =
  Layer.succeed(
    CriticScoreService,
    CriticScoreService.of({ scoreFor: () => Effect.succeed(null) }),
  )
