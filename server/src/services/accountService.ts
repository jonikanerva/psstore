import type { PageResult } from '@psstore/shared'
import { Context, Effect, Layer, Redacted } from 'effect'
import { mapPurchasedToGames } from '../domain/library.js'
import type {
  SessionRejected,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import { SonyAccountClient } from '../sony/sonyClient.js'

// The signed-in surface. Stateless and uncached: every call exchanges the NPSSO
// again, and nothing derived from it outlives the call. A failure logs only its
// tag; the NPSSO, the access token and Sony headers never reach a log.

type AccountError = SessionRejected | UpstreamUnavailable | UpstreamRateLimited

const logFailure = <A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.tapError(effect, (error) =>
    Effect.logWarning('account request failed', { reason: error._tag }),
  )

export interface AccountServiceApi {
  // Succeeds only when Sony accepts the NPSSO. The access token is discarded.
  readonly verifyNpsso: (
    npsso: Redacted.Redacted,
  ) => Effect.Effect<void, AccountError>
  // The whole PS5 library as one response page.
  readonly getPurchasedGames: (
    npsso: Redacted.Redacted,
  ) => Effect.Effect<PageResult, AccountError | UpstreamQueryRotated>
}

export class AccountService extends Context.Service<
  AccountService,
  AccountServiceApi
>()('AccountService') {}

export const AccountServiceLive: Layer.Layer<
  AccountService,
  never,
  SonyAccountClient
> = Layer.effect(
  AccountService,
  Effect.gen(function* () {
    const sony = yield* SonyAccountClient
    return AccountService.of({
      verifyNpsso: (npsso) =>
        logFailure(sony.exchangeNpsso(npsso)).pipe(Effect.asVoid),
      getPurchasedGames: (npsso) =>
        logFailure(
          Effect.flatMap(sony.exchangeNpsso(npsso), sony.fetchPurchasedGames),
        ).pipe(
          Effect.map((entries): PageResult => {
            const games = mapPurchasedToGames(entries)
            return { games, totalCount: games.length, nextOffset: null }
          }),
        ),
    })
  }),
)
