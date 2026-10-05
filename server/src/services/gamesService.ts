import {
  gameSchema,
  type Game,
  type PageResult,
  type PlusOffer,
} from '@psstore/shared'
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Schema,
} from 'effect'
import { CACHE_TTL, SONY_SEARCH_MAX_PAGE_SIZE } from '../config/env.js'
import {
  GameNotFound,
  UpstreamUnavailable,
  type UpstreamQueryRotated,
  type UpstreamRateLimited,
} from '../errors/errors.js'
import { conceptToGame, productDetailToGame } from '../sony/mapper.js'
import type { ProductPrice } from '../sony/productPriceSchema.js'
import { SonyClient, type ProductDetailResult } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'
import {
  conceptProductId,
  DISCOUNTED_GAME_CLASSIFICATIONS,
  hasReleaseDate,
  inNewWindow,
  inUpcomingWindow,
  isPs5Game,
  isValidProductId,
  mapConceptsToGames,
  mapMonthlyToGames,
  mapUpcomingConceptsToGames,
  mergeReleaseGrids,
  paginate,
  type SearchCandidate,
  sortByDate,
  type SortOrder,
} from '../domain/listing.js'

const decodeGame = Schema.decodeUnknownSync(gameSchema)

// The upstream error channel the Sony client can surface. Every list tab and
// the PDP propagate it to the HTTP layer (502/502/503); do not swallow it
// into an empty result.
type UpstreamError =
  UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited

// NEW fetches a wider window than the other features. With the
// `conceptReleaseDate:last_thirty_days` facet the released PS5 candidate set is
// bounded, so 300 covers the full window in one request. The enrichment N+1
// stays bounded by this set (STACK.md §4).
const NEW_LIST_PAGE_SIZE = 300
const LIST_PAGE_SIZE = 120
const DETAIL_TTL = Duration.hours(6)
const PRICE_TTL = Duration.minutes(10)
const PRICE_FAILURE_TTL = Duration.seconds(30)
// Detail read only by the product-id fallback. An id Sony does not know
// answers 200 with no data; that miss is cached shorter than a real product.
const STRICT_DETAIL_TTL = Duration.hours(6)
const STRICT_DETAIL_MISS_TTL = Duration.minutes(5)
const STRICT_DETAIL_FAILURE_TTL = Duration.seconds(30)
const MONTHLY_TTL = Duration.hours(1)
const MONTHLY_FAILURE_TTL = Duration.seconds(30)
// Raw search pages read for one request when pages narrow to zero games.
const SEARCH_RAW_PAGE_BOUND = 3
// Concurrent product detail lookups for one search page. Each page holds at
// most SONY_SEARCH_MAX_PAGE_SIZE candidates.
const SEARCH_DETAIL_CONCURRENCY = 10

interface ProductMeta {
  readonly date: string
  readonly classification: string | null
  readonly genres: readonly string[]
  readonly platforms: readonly string[]
}

export interface GamesServiceApi {
  readonly getNewGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamError>
  readonly getUpcomingGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamError>
  readonly getDiscountedGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamError>
  readonly getMonthlyGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamError>
  readonly searchGames: (
    term: string,
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamError>
  readonly getGameById: (
    id: string,
  ) => Effect.Effect<Game, GameNotFound | UpstreamError>
}

export class GamesService extends Context.Service<
  GamesService,
  GamesServiceApi
>()('GamesService') {}

export const GamesServiceLive: Layer.Layer<GamesService, never, SonyClient> =
  Layer.effect(
    GamesService,
    Effect.gen(function* () {
      const sony = yield* SonyClient
      const listTtl = CACHE_TTL

      // One cache per keyspace + TTL (no string→unknown erasure). Each cache's
      // lookup is the side-effecting fetch; concurrent gets share a single fetch.

      // Concepts per feature. NEW uses the wider window; upcoming/discounted use
      // the standard list size. Failures propagate up the typed error channel
      // for all three features (see `featureConcepts` / `baseGames`). Effect
      // `Cache` pins a FAILED lookup for the full TTL (CACHE_TTL = 30s) the same
      // as a success, so a recovered Sony still serves the failure until expiry.
      const conceptsCache = yield* Cache.make<
        'new' | 'upcoming' | 'discounted',
        Concept[],
        UpstreamError
      >({
        capacity: 16,
        timeToLive: listTtl,
        lookup: (feature) =>
          sony.fetchConceptsByFeature(
            feature,
            feature === 'new' ? NEW_LIST_PAGE_SIZE : LIST_PAGE_SIZE,
          ),
      })

      // Per-product detail (release date, classification, genres, description,
      // publisher), cached 6h and shared by both the list date enrichment and the
      // PDP enrichment so each product is fetched at most once per TTL. A failed
      // enrichment degrades to an empty detail rather than failing the listing.
      const productDetailCache = yield* Cache.make<string, ProductDetailResult>(
        {
          capacity: 10_000,
          timeToLive: DETAIL_TTL,
          lookup: (productId) =>
            sony.fetchProductDetail(productId).pipe(
              Effect.catch(() =>
                Effect.succeed<ProductDetailResult>({
                  media: [],
                  genres: [],
                  description: '',
                }),
              ),
            ),
        },
      )

      // Per-product PS Plus offer, read only by the game page. A failed lookup is
      // cached as a failure for the short TTL so a Sony outage is not retried on
      // every page view.
      const productPriceCache = yield* Cache.makeWith(
        (productId: string) => sony.fetchProductPrice(productId),
        {
          capacity: 1_000,
          timeToLive: (exit) =>
            Exit.isSuccess(exit) ? PRICE_TTL : PRICE_FAILURE_TTL,
        },
      )

      // Product detail for the product-id fallback. Unlike productDetailCache a
      // failure stays in the error channel, so an outage is never read as
      // "no such game".
      const strictDetailCache = yield* Cache.makeWith<
        string,
        ProductDetailResult,
        UpstreamError
      >((productId) => sony.fetchProductDetail(productId), {
        capacity: 1_000,
        timeToLive: (exit) => {
          if (Exit.isFailure(exit)) {
            return STRICT_DETAIL_FAILURE_TTL
          }
          return (exit.value.platforms ?? []).length === 0
            ? STRICT_DETAIL_MISS_TTL
            : STRICT_DETAIL_TTL
        },
      })

      // The whole monthly list under one key; a failure is cached briefly so an
      // outage is not retried on every request.
      const monthlyCache = yield* Cache.makeWith<
        'monthly',
        Game[],
        UpstreamError
      >(
        () =>
          sony
            .fetchPlusMonthly()
            .pipe(Effect.map((entries) => mapMonthlyToGames(entries))),
        {
          capacity: 1,
          timeToLive: (exit) =>
            Exit.isSuccess(exit) ? MONTHLY_TTL : MONTHLY_FAILURE_TTL,
        },
      )

      const getMonthlyGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamError> =>
        Cache.get(monthlyCache, 'monthly').pipe(
          Effect.tapError((error) =>
            Effect.logWarning('monthly games query failed', {
              reason: error._tag,
            }),
          ),
          Effect.map((games) => paginate(games, offset, size)),
        )

      const plusOfferFor = (game: Game): Effect.Effect<PlusOffer | null> =>
        game.idKind === 'product'
          ? Cache.get(productPriceCache, game.id).pipe(
              Effect.map((price) => price.plusOffer),
              Effect.catch((error) =>
                Effect.logWarning('plus offer lookup failed', {
                  reason: error._tag,
                }).pipe(Effect.as(null)),
              ),
            )
          : Effect.succeed(null)

      const productMeta = (productId: string): Effect.Effect<ProductMeta> =>
        Cache.get(productDetailCache, productId).pipe(
          Effect.map((detail) => ({
            date: detail.releaseDate ?? '',
            classification: detail.storeDisplayClassification ?? null,
            genres: detail.genres,
            platforms: detail.platforms ?? [],
          })),
        )

      // Upcoming/discounted concept fetch. The upstream failure PROPAGATES; do not
      // swallow it into `[]`. A Sony outage surfaces as a 502/503, as NEW does
      // via `baseGames`. `tapError` logs the warning without touching the error
      // channel. A genuinely empty grid returns `[]` through the SUCCESS channel,
      // so "empty" stays distinct from "error".
      const featureConcepts = (
        feature: 'upcoming' | 'discounted',
      ): Effect.Effect<Concept[], UpstreamError> =>
        Cache.get(conceptsCache, feature).pipe(
          Effect.tapError((error) =>
            Effect.logWarning('feature concept query failed', {
              feature,
              reason: error._tag,
            }),
          ),
        )

      const enrichDate = (game: Game): Effect.Effect<Game> =>
        productMeta(game.id).pipe(
          Effect.map((meta) => ({ ...game, date: meta.date })),
        )

      const baseGames = (): Effect.Effect<Game[], UpstreamError> =>
        Cache.get(conceptsCache, 'new').pipe(
          Effect.map((concepts) => mapConceptsToGames(concepts)),
        )

      // NEW and UPCOMING both read the released and the upcoming grid, in
      // parallel. A failure of either grid fails the list: one grid alone can
      // silently omit a released game that Sony files as upcoming. The
      // released grid keeps dated product SKUs only. The upcoming grid also
      // keeps undated products and concept-only announcements. The product
      // boundary is never called on a bare concept id.
      const releaseGames = (): Effect.Effect<Game[], UpstreamError> =>
        Effect.all([baseGames(), featureConcepts('upcoming')], {
          concurrency: 'unbounded',
        }).pipe(
          Effect.flatMap(([released, upcoming]) =>
            Effect.all(
              [
                Effect.forEach(released, enrichDate, {
                  concurrency: 'unbounded',
                }).pipe(Effect.map((games) => games.filter(hasReleaseDate))),
                Effect.forEach(
                  mapUpcomingConceptsToGames(upcoming),
                  (game) =>
                    game.idKind === 'product'
                      ? enrichDate(game)
                      : Effect.succeed(game),
                  { concurrency: 'unbounded' },
                ),
              ],
              { concurrency: 'unbounded' },
            ),
          ),
          Effect.map(([released, upcoming]) =>
            mergeReleaseGrids(released, upcoming),
          ),
        )

      // The windows are supersets of the client's local-day split (see
      // `inNewWindow`). NEW is newest first. UPCOMING is soonest first; the
      // +Infinity ascending sentinel puts undated cards last, in grid order.
      const releaseListing = (
        window: (games: readonly Game[], nowMs: number) => Game[],
        order: SortOrder,
        offset: number,
        size: number,
      ): Effect.Effect<PageResult, UpstreamError> =>
        Effect.all([releaseGames(), Clock.currentTimeMillis]).pipe(
          Effect.map(([games, nowMs]) =>
            paginate(sortByDate(window(games, nowMs), order), offset, size),
          ),
        )

      const getNewGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamError> =>
        releaseListing(inNewWindow, 'date-desc', offset, size)

      const getUpcomingGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamError> =>
        releaseListing(inUpcomingWindow, 'date-asc', offset, size)

      // DISCOUNTED enriches each grid concept once, reading release date AND store
      // classification, then keeps only full-game SKUs (DLC / currency / themes /
      // editions dropped — VISION forbids them). No released-date gate; newest
      // first.
      const getDiscountedGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamError> =>
        featureConcepts('discounted').pipe(
          Effect.map((concepts) => mapConceptsToGames(concepts)),
          Effect.flatMap((games) =>
            Effect.forEach(
              games,
              (game) =>
                productMeta(game.id).pipe(
                  Effect.map((meta) => ({
                    game: { ...game, date: meta.date },
                    meta,
                  })),
                ),
              { concurrency: 'unbounded' },
            ),
          ),
          // DELIBERATE VISION-safety drop: a concept with an unknown/absent
          // `storeDisplayClassification` (classification === null) is DROPPED,
          // never shown. A non-game SKU (DLC / currency / theme / edition) can
          // never leak into the games-only grid. A real discounted game whose
          // per-product enrichment transiently FAILS also reads as
          // classification:null and is dropped, until the 6h productDetailCache
          // refreshes. The `Boolean(game.date)` gate below is a separate
          // (date-sort) drop.
          Effect.map((enriched) =>
            enriched
              .filter(
                ({ meta }) =>
                  meta.classification !== null &&
                  DISCOUNTED_GAME_CLASSIFICATIONS.has(meta.classification),
              )
              .map(({ game }) => game)
              .filter((game) => Boolean(game.date)),
          ),
          Effect.map((gamesOnly) =>
            paginate(sortByDate(gamesOnly, 'date-desc'), offset, size),
          ),
        )

      // A candidate Sony proved PS5 only by naming its product id is checked
      // against the product detail; a failed detail lookup drops it. The
      // search result is never cached, so only the detail lookups are shared.
      const resolveSearchCandidate = (
        candidate: SearchCandidate,
      ): Effect.Effect<Game | null> => {
        const base = conceptToGame(candidate.concept)
        return productMeta(base.id).pipe(
          Effect.map((meta) =>
            candidate.kind === 'unverified' &&
            !isPs5Game(meta.platforms, meta.classification)
              ? null
              : decodeGame({
                  ...base,
                  date: meta.date,
                  genres:
                    meta.genres.length > 0 ? [...meta.genres] : base.genres,
                }),
          ),
        )
      }

      // `nextOffset` follows Sony's raw paging, never the narrowed length. A raw
      // page that narrows to zero games reads the next one, up to the bound.
      const searchGames = (
        term: string,
        offset = 0,
        size = SONY_SEARCH_MAX_PAGE_SIZE,
      ): Effect.Effect<PageResult, UpstreamError> => {
        const readPage = (
          rawOffset: number,
          pagesLeft: number,
        ): Effect.Effect<PageResult, UpstreamError> =>
          sony.fetchSearchPage(term, rawOffset, size).pipe(
            Effect.tapError((error) =>
              Effect.logWarning('search query failed', {
                reason: error._tag,
              }),
            ),
            Effect.flatMap((page) => {
              const nextOffset = page.isLast ? null : rawOffset + size
              return Effect.forEach(page.candidates, resolveSearchCandidate, {
                concurrency: SEARCH_DETAIL_CONCURRENCY,
              }).pipe(
                Effect.map((resolved) =>
                  resolved.flatMap((game) => (game === null ? [] : [game])),
                ),
                Effect.flatMap((games) =>
                  games.length === 0 && nextOffset !== null && pagesLeft > 1
                    ? readPage(nextOffset, pagesLeft - 1)
                    : Effect.succeed<PageResult>({
                        games,
                        totalCount: games.length,
                        nextOffset,
                      }),
                ),
              )
            }),
          )

        return readPage(offset, SEARCH_RAW_PAGE_BOUND)
      }

      const enrichWithDetail = (game: Game): Effect.Effect<Game> =>
        Effect.all(
          [Cache.get(productDetailCache, game.id), plusOfferFor(game)],
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.map(([detail, plusOffer]): Game => ({
            ...game,
            date: detail.releaseDate ?? game.date,
            genres: detail.genres.length > 0 ? [...detail.genres] : game.genres,
            description: detail.description || game.description,
            studio: detail.publisherName || game.studio,
            plusOffer,
          })),
        )

      // Propagates the upstream error: a PDP lookup for an upcoming/discounted id
      // surfaces a 502/503 on a Sony outage, never a misleading 404.
      const findInFeature = (
        feature: 'upcoming' | 'discounted',
        id: string,
      ): Effect.Effect<Game | null, UpstreamError> =>
        featureConcepts(feature).pipe(
          Effect.map((concepts) =>
            concepts.filter((concept) => conceptProductId(concept) === id),
          ),
          Effect.map((matching) =>
            matching.length === 0
              ? null
              : (mapConceptsToGames(matching).find((game) => game.id === id) ??
                null),
          ),
        )

      // The price of a game found by product id only. A failed price lookup
      // leaves the game without a price instead of failing the page.
      const priceOrNone = (productId: string): Effect.Effect<ProductPrice> =>
        Cache.get(productPriceCache, productId).pipe(
          Effect.catch((error) =>
            Effect.logWarning('product price lookup failed', {
              reason: error._tag,
            }).pipe(
              Effect.as<ProductPrice>({ plusOffer: null, standard: null }),
            ),
          ),
        )

      // Runs only after every list missed. Upstream failure propagates; only a
      // valid id that Sony proves is not a PS5 game is GameNotFound.
      const fromProductId = (
        id: string,
      ): Effect.Effect<Game, GameNotFound | UpstreamError> =>
        Effect.gen(function* () {
          if (!isValidProductId(id)) {
            return yield* Effect.fail(new GameNotFound({ id }))
          }

          const [detail, price] = yield* Effect.all(
            [Cache.get(strictDetailCache, id), priceOrNone(id)],
            { concurrency: 'unbounded' },
          )

          if (
            (detail.platforms ?? []).length === 0 ||
            !isPs5Game(detail.platforms, detail.storeDisplayClassification)
          ) {
            return yield* Effect.fail(new GameNotFound({ id }))
          }

          if (!detail.name) {
            yield* Effect.logWarning('product detail without a name', {
              reason: 'empty_name',
            })
            return yield* Effect.fail(
              new UpstreamUnavailable({
                message: 'Sony returned a PS5 product without a name',
              }),
            )
          }

          return decodeGame({
            ...productDetailToGame(id, detail, price.standard),
            description: detail.description,
            plusOffer: price.plusOffer,
          })
        })

      const getGameById = (
        id: string,
      ): Effect.Effect<Game, GameNotFound | UpstreamError> =>
        Effect.gen(function* () {
          const games = yield* baseGames()
          const base = games.find((item) => item.id === id)
          if (base) {
            return decodeGame(yield* enrichWithDetail(base))
          }

          for (const feature of ['upcoming', 'discounted'] as const) {
            const featureGame = yield* findInFeature(feature, id)
            if (featureGame) {
              return decodeGame(yield* enrichWithDetail(featureGame))
            }
          }

          const monthlyGame = (yield* Cache.get(monthlyCache, 'monthly')).find(
            (item) => item.id === id,
          )
          if (monthlyGame) {
            return decodeGame(yield* enrichWithDetail(monthlyGame))
          }

          return yield* fromProductId(id)
        })

      return GamesService.of({
        getNewGames,
        getUpcomingGames,
        getDiscountedGames,
        getMonthlyGames,
        searchGames,
        getGameById,
      })
    }),
  )
