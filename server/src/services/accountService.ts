import type { Game, PageResult } from '@psstore/shared'
import { Context, Effect, Layer, RcMap, Redacted } from 'effect'
import {
  WISHLIST_ENRICH_CONCURRENCY,
  WISHLIST_ENRICH_ENTRY_TIMEOUT_MS,
  WISHLIST_ENRICH_TOTAL_TIMEOUT_MS,
} from '../config/env.js'
import {
  mapPurchasedToGames,
  mapWishlistToGames,
  mergeWishlistEntry,
} from '../domain/library.js'
import type {
  SessionRejected,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import type { WishlistEntry } from '../sony/wishlistSchema.js'
import { SonyAccountClient } from '../sony/sonyClient.js'
import { GamesService } from './gamesService.js'

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
  // The user's whole Sony wishlist as one response page.
  readonly getWishlistGames: (
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
  SonyAccountClient | GamesService
> = Layer.effect(
  AccountService,
  Effect.gen(function* () {
    const sony = yield* SonyAccountClient
    const games = yield* GamesService
    const exchanges = yield* RcMap.make({
      lookup: (npsso: Redacted.Redacted) => sony.exchangeNpsso(npsso),
    })
    // The scope covers the exchange only. It must close before the library
    // crawl so the shared entry never outlives the token hand-over.
    const exchange = (npsso: Redacted.Redacted) =>
      RcMap.get(exchanges, npsso).pipe(Effect.scoped)
    const wholePage = (games: PageResult['games']): PageResult => ({
      games,
      totalCount: games.length,
      nextOffset: null,
    })
    // Fills a product entry from the public Finnish store, the source of the
    // other views. A missing, slow or failed lookup leaves the minimal card.
    // The wishlist and the token are not cached; only the lookups are.
    const enrichEntry = (entry: WishlistEntry): Effect.Effect<Game> =>
      entry.idKind === 'product'
        ? games.getGameById(entry.id).pipe(
            Effect.timeout(WISHLIST_ENRICH_ENTRY_TIMEOUT_MS),
            Effect.map((found) => mergeWishlistEntry(entry, found)),
            Effect.catch(() => Effect.succeed(mergeWishlistEntry(entry, null))),
          )
        : Effect.succeed(mergeWishlistEntry(entry, null))

    const enrichWishlist = (
      entries: readonly WishlistEntry[],
    ): Effect.Effect<Game[]> =>
      Effect.forEach(entries, enrichEntry, {
        concurrency: WISHLIST_ENRICH_CONCURRENCY,
      }).pipe(
        Effect.timeoutOrElse({
          duration: WISHLIST_ENRICH_TOTAL_TIMEOUT_MS,
          orElse: () => Effect.succeed(mapWishlistToGames(entries)),
        }),
        Effect.tap((cards) =>
          Effect.logInfo('wishlist enriched', {
            entries: entries.length,
            priced: cards.filter((card) => card.price !== '').length,
          }),
        ),
      )

    return AccountService.of({
      verifyNpsso: (npsso) => logFailure(exchange(npsso)).pipe(Effect.asVoid),
      getPurchasedGames: (npsso) =>
        logFailure(
          Effect.flatMap(exchange(npsso), sony.fetchPurchasedGames),
        ).pipe(
          Effect.map((entries) => wholePage(mapPurchasedToGames(entries))),
        ),
      getWishlistGames: (npsso) =>
        logFailure(
          Effect.flatMap(exchange(npsso), sony.fetchWishlistGames),
        ).pipe(Effect.flatMap(enrichWishlist), Effect.map(wholePage)),
    })
  }),
)
