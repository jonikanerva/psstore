import { gameSchema, type Game, type PageResult } from '@psstore/shared'
import { Cache, Context, Duration, Effect, Layer, Schema } from 'effect'
import { CACHE_TTL } from '../config/env.js'
import { GameNotFound, type UpstreamUnavailable } from '../errors/errors.js'
import { SonyClient, type ProductDetailResult } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'
import {
  applyDateFilter,
  conceptProductId,
  DISCOUNTED_GAME_CLASSIFICATIONS,
  mapConceptsToGames,
  mapUpcomingConceptsToGames,
  paginate,
  sortByDate,
  type SortOrder,
} from '../domain/listing.js'

const decodeGame = Schema.decodeUnknownSync(gameSchema)

// NEW fetches a wider window than the other features. With the
// `conceptReleaseDate:last_thirty_days` facet the released PS5 candidate set is
// bounded (~177 live), so 300 covers the full window in one request — no blind
// prefix can strand a recent release. The enrichment N+1 stays bounded by this
// set (STACK.md §4). The N+1 reduction is deferred to issue #44.
const NEW_LIST_PAGE_SIZE = 300
const LIST_PAGE_SIZE = 120
const DETAIL_TTL = Duration.hours(6)

interface ProductMeta {
  readonly date: string
  readonly classification: string | null
}

export interface GamesServiceApi {
  readonly getNewGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamUnavailable>
  readonly getUpcomingGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamUnavailable>
  readonly getDiscountedGames: (
    offset?: number,
    size?: number,
  ) => Effect.Effect<PageResult, UpstreamUnavailable>
  readonly getGameById: (
    id: string,
  ) => Effect.Effect<Game, GameNotFound | UpstreamUnavailable>
}

export class GamesService extends Context.Tag('GamesService')<
  GamesService,
  GamesServiceApi
>() {}

export const GamesServiceLive: Layer.Layer<GamesService, never, SonyClient> =
  Layer.effect(
    GamesService,
    Effect.gen(function* () {
      const sony = yield* SonyClient
      const listTtl = CACHE_TTL

      // One cache per keyspace + TTL (no string→unknown erasure). Each cache's
      // lookup is the side-effecting fetch; concurrent gets share a single fetch.

      // Concepts per feature. NEW uses the wider window; upcoming/discounted use
      // the standard list size. Failures propagate as UpstreamUnavailable here;
      // the upcoming/discounted call sites degrade to an empty list.
      const conceptsCache = yield* Cache.make<
        'new' | 'upcoming' | 'discounted',
        Concept[],
        UpstreamUnavailable
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
      // enrichment degrades to an empty detail rather than failing the listing
      // (matches the previous per-product try/catch).
      const productDetailCache = yield* Cache.make<string, ProductDetailResult>(
        {
          capacity: 10_000,
          timeToLive: DETAIL_TTL,
          lookup: (productId) =>
            sony.fetchProductDetail(productId).pipe(
              Effect.catchAll(() =>
                Effect.succeed<ProductDetailResult>({
                  genres: [],
                  description: '',
                }),
              ),
            ),
        },
      )

      const productMeta = (productId: string): Effect.Effect<ProductMeta> =>
        productDetailCache.get(productId).pipe(
          Effect.map((detail) => ({
            date: detail.releaseDate ?? '',
            classification: detail.storeDisplayClassification ?? null,
          })),
        )

      const featureConcepts = (
        feature: 'upcoming' | 'discounted',
      ): Effect.Effect<Concept[]> =>
        conceptsCache.get(feature).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              'feature concept query failed; using empty fallback',
              {
                feature,
                reason: error._tag,
              },
            ).pipe(Effect.as<Concept[]>([])),
          ),
        )

      const enrichDate = (game: Game): Effect.Effect<Game> =>
        productMeta(game.id).pipe(
          Effect.map((meta) => ({ ...game, date: meta.date })),
        )

      const baseGames = (): Effect.Effect<Game[], UpstreamUnavailable> =>
        conceptsCache
          .get('new')
          .pipe(Effect.map((concepts) => mapConceptsToGames(concepts)))

      const enrichedListing = (
        games: Game[],
        order: SortOrder,
        dateFilter: 'released' | 'none',
        offset: number,
        size: number,
      ): Effect.Effect<PageResult> =>
        Effect.forEach(games, enrichDate, { concurrency: 'unbounded' }).pipe(
          Effect.map((enriched) =>
            enriched.filter((game) => Boolean(game.date)),
          ),
          Effect.map((withDates) => applyDateFilter(withDates, dateFilter)),
          Effect.map((filtered) =>
            paginate(sortByDate(filtered, order), offset, size),
          ),
        )

      const getNewGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamUnavailable> =>
        baseGames().pipe(
          Effect.flatMap((games) =>
            enrichedListing(games, 'date-desc', 'released', offset, size),
          ),
        )

      // UPCOMING surfaces ALL anonymously-available upcoming PS5 games (owner
      // ruling 2026-05-29, option a): priced product SKUs (internal PDP cards) AND
      // concept-only announcements (price "Unknown", linking out). It does NOT use
      // enrichedListing: it keeps SKU-less concept cards, enriches dates ONLY for
      // product SKUs (never calls the product boundary on a bare concept id), and
      // applies no date filter. The +Infinity ascending sentinel + stable index
      // tiebreaker put dated SKU cards first and undated concept cards after, in
      // Sony grid order.
      const getUpcomingGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamUnavailable> =>
        featureConcepts('upcoming').pipe(
          Effect.map((concepts) => mapUpcomingConceptsToGames(concepts)),
          Effect.flatMap((games) =>
            Effect.forEach(
              games,
              (game) =>
                game.idKind === 'product'
                  ? enrichDate(game)
                  : Effect.succeed(game),
              { concurrency: 'unbounded' },
            ),
          ),
          Effect.map((enriched) =>
            paginate(sortByDate(enriched, 'date-asc'), offset, size),
          ),
        )

      // DISCOUNTED enriches each grid concept once, reading release date AND store
      // classification, then keeps only full-game SKUs (DLC / currency / themes /
      // editions dropped — VISION forbids them). No released-date gate; newest
      // first.
      const getDiscountedGames = (
        offset = 0,
        size = 60,
      ): Effect.Effect<PageResult, UpstreamUnavailable> =>
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

      const enrichWithDetail = (game: Game): Effect.Effect<Game> =>
        productDetailCache.get(game.id).pipe(
          Effect.map(
            (detail): Game => ({
              ...game,
              date: detail.releaseDate ?? game.date,
              genres:
                detail.genres.length > 0 ? [...detail.genres] : game.genres,
              description: detail.description || game.description,
              studio: detail.publisherName || game.studio,
            }),
          ),
        )

      const findInFeature = (
        feature: 'upcoming' | 'discounted',
        id: string,
      ): Effect.Effect<Game | null> =>
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

      const getGameById = (
        id: string,
      ): Effect.Effect<Game, GameNotFound | UpstreamUnavailable> =>
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

          return yield* Effect.fail(new GameNotFound({ id }))
        })

      return GamesService.of({
        getNewGames,
        getUpcomingGames,
        getDiscountedGames,
        getGameById,
      })
    }),
  )
