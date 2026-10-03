import type { PageResult } from '@psstore/shared'
import { Context, Effect, Layer, RcMap, Redacted } from 'effect'
import { mapPurchasedToGames } from '../domain/library.js'
import type {
  SessionRejected,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import { SonyAccountClient } from '../sony/sonyClient.js'

// The signed-in surface. Concurrent calls with the same NPSSO share one in-flight
// exchange. The shared entry ends when its last caller has the token: no access
// token is retained. A failure logs only its tag, never the NPSSO or a token.

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
    const exchanges = yield* RcMap.make({
      lookup: (npsso: Redacted.Redacted) => sony.exchangeNpsso(npsso),
    })
    // The scope covers the exchange only. It must close before the library
    // crawl so the shared entry never outlives the token hand-over.
    const exchange = (npsso: Redacted.Redacted) =>
      RcMap.get(exchanges, npsso).pipe(Effect.scoped)
    return AccountService.of({
      verifyNpsso: (npsso) => logFailure(exchange(npsso)).pipe(Effect.asVoid),
      getPurchasedGames: (npsso) =>
        logFailure(
          Effect.flatMap(exchange(npsso), sony.fetchPurchasedGames),
        ).pipe(
          Effect.map((entries): PageResult => {
            const games = mapPurchasedToGames(entries)
            return { games, totalCount: games.length, nextOffset: null }
          }),
        ),
    })
  }),
)
