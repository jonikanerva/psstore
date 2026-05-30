import { gameSchema, type Game, type PageResult } from '@psstore/shared'
import { Schema } from 'effect'
import { MemoryCache } from '../lib/cache.js'
import { HttpError } from '../errors/httpError.js'
import { env } from '../config/env.js'
import {
  fetchConceptsByFeature,
  fetchProductDetail,
} from '../sony/sonyClient.js'
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
import type { Concept } from '../sony/types.js'

const decodeGame = Schema.decodeUnknownSync(gameSchema)

const cache = new MemoryCache()
const LIST_PAGE_SIZE = 120
// NEW fetches a wider window than the other features. With the
// `conceptReleaseDate:last_thirty_days` facet (queryStrategies.ts) the released
// PS5 candidate set is bounded (~177 live), so 300 covers the full window in one
// request with growth headroom — no blind prefix can strand a recent release
// beyond the cap (spike doc, section B). The enrichment N+1 stays bounded by
// this set, keeping NEW within the STACK.md §4 budgets.
const NEW_LIST_PAGE_SIZE = 300
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000
const RELEASE_DATE_TTL_MS = 6 * 60 * 60 * 1000
const LIST_CACHE_PREFIX = 'v2:'

const withCache = async <T>(key: string, resolve: () => Promise<T>): Promise<T> => {
  const hit = cache.get<T>(key)
  if (hit) {
    return hit
  }

  const value = await resolve()
  cache.set(key, value, env.CACHE_TTL_MS)
  return value
}

const enrichGameDate = async (game: Game): Promise<Game> => {
  const cacheKey = `release-date:${game.id}`
  const cached = cache.get<string>(cacheKey)
  if (cached !== undefined) {
    return { ...game, date: cached }
  }

  try {
    const detail = await fetchProductDetail(game.id)
    const date = detail.releaseDate ?? ''
    cache.set(cacheKey, date, RELEASE_DATE_TTL_MS)
    return { ...game, date }
  } catch (error) {
    console.warn(`Release date lookup failed for ${game.id}`, error)
    cache.set(cacheKey, '', RELEASE_DATE_TTL_MS)
    return game
  }
}

const enrichGamesWithDates = async (games: Game[]): Promise<Game[]> => {
  const enriched = await Promise.all(games.map((game) => enrichGameDate(game)))
  return enriched.filter((game) => Boolean(game.date))
}

// DISCOUNTED needs the per-product store classification in addition to the
// release date so it can drop non-game SKUs (DLC, currency, themes — forbidden
// by VISION). The metadata comes from the same `metGetProductById` call NEW /
// UPCOMING already make for the date, so DISCOUNTED reads BOTH in one fetch and
// caches them together under a distinct `product-meta:` key. The existing
// `release-date:` cache stays untouched so the NEW / UPCOMING date path keeps
// its own warm entries (no cross-feature cache collision).
interface ProductMeta {
  date: string
  classification: string | null
}

const enrichGameMeta = async (game: Game): Promise<{ game: Game; meta: ProductMeta }> => {
  const cacheKey = `product-meta:${game.id}`
  const cached = cache.get<ProductMeta>(cacheKey)
  if (cached !== undefined) {
    return { game: { ...game, date: cached.date }, meta: cached }
  }

  try {
    const detail = await fetchProductDetail(game.id)
    const meta: ProductMeta = {
      date: detail.releaseDate ?? '',
      classification: detail.storeDisplayClassification ?? null,
    }
    cache.set(cacheKey, meta, RELEASE_DATE_TTL_MS)
    return { game: { ...game, date: meta.date }, meta }
  } catch (error) {
    console.warn(`Product meta lookup failed for ${game.id}`, error)
    const meta: ProductMeta = { date: '', classification: null }
    cache.set(cacheKey, meta, RELEASE_DATE_TTL_MS)
    return { game, meta }
  }
}

const detailCacheKey = (id: string): string => `${LIST_CACHE_PREFIX}game-detail:${id}`

const baseConcepts = async (): Promise<Concept[]> =>
  withCache(`${LIST_CACHE_PREFIX}concepts-new`, async () => fetchConceptsByFeature('new', NEW_LIST_PAGE_SIZE))

const baseGames = async (): Promise<Game[]> =>
  withCache(`${LIST_CACHE_PREFIX}games-new`, async () => mapConceptsToGames(await baseConcepts()))

const featureConcepts = async (feature: 'upcoming' | 'discounted'): Promise<Concept[]> =>
  withCache(`${LIST_CACHE_PREFIX}concepts-${feature}`, async () => {
    try {
      return await fetchConceptsByFeature(feature, LIST_PAGE_SIZE)
    } catch (error) {
      console.warn(`Feature query failed for ${feature}; using base fallback`, error)
      return []
    }
  })

const findGameInFeatureConcepts = async (
  feature: 'upcoming' | 'discounted',
  id: string,
): Promise<Game | null> => {
  const concepts = await featureConcepts(feature)
  const matchingConcepts = concepts.filter((concept) => conceptProductId(concept) === id)
  if (matchingConcepts.length === 0) {
    return null
  }

  const games = mapConceptsToGames(matchingConcepts)
  return games.find((game) => game.id === id) ?? null
}

const enrichedListing = async (
  gamesPromise: Promise<Game[]> | Game[],
  order: SortOrder,
  dateFilter: 'released' | 'none',
  offset: number,
  size: number,
): Promise<PageResult> => {
  const allGames = await gamesPromise
  const enriched = await enrichGamesWithDates(allGames)
  const filtered = applyDateFilter(enriched, dateFilter)
  const sorted = sortByDate(filtered, order)
  return paginate(sorted, offset, size)
}

export const getNewGames = async (offset = 0, size = 60): Promise<PageResult> =>
  enrichedListing(baseGames(), 'date-desc', 'released', offset, size)

// UPCOMING surfaces ALL anonymously-available upcoming PS5 games (owner ruling
// 2026-05-29, option a): the ~12 priced product SKUs (internal PDP cards) AND
// the ~40 concept-only announcements (price "Unknown", linking out to Sony's
// concept page). It therefore does NOT use the shared `enrichedListing`:
//   - `mapUpcomingConceptsToGames` keeps SKU-less concept cards (the shared
//     `mapConceptsToGames` would drop them via `isValidProductId`);
//   - dates are enriched ONLY for `idKind === 'product'`, so the
//     `metGetProductById` boundary is NEVER called on a bare concept id (Sony
//     exposes no anonymous date for concept-only titles);
//   - NO empty-date filter (it would re-drop all concept cards) and NO `> now`
//     filter (the `next_thirty_days` facet is the authoritative window).
// `sortByDate(_, 'date-asc')` + the +Infinity sentinel and stable index
// tiebreaker put the dated SKU cards first (soonest-first) and the undated
// concept cards after, in Sony grid order. NEW / DISCOUNTED are untouched and
// still call the shared `enrichedListing` / `enrichGamesWithDates`.
export const getUpcomingGames = async (offset = 0, size = 60): Promise<PageResult> => {
  const games = mapUpcomingConceptsToGames(await featureConcepts('upcoming'))
  const enriched = await Promise.all(
    games.map((game) => (game.idKind === 'product' ? enrichGameDate(game) : Promise.resolve(game))),
  )
  return paginate(sortByDate(enriched, 'date-asc'), offset, size)
}

// DISCOUNTED enriches each grid concept once via `metGetProductById`, reading
// the release date AND the store classification, then keeps only full-game SKUs
// (DLC / currency / themes / editions are dropped — VISION forbids them). No
// `released` date gate (avoids the NEW-style stranding of valid future-dated
// deals); sort newest-first. The N+1 enrichment stays (cached 6h, within
// STACK.md §4); the N+1 reduction is deferred to issue #44.
export const getDiscountedGames = async (offset = 0, size = 60): Promise<PageResult> => {
  const games = mapConceptsToGames(await featureConcepts('discounted'))
  const enriched = await Promise.all(games.map((game) => enrichGameMeta(game)))
  const gamesOnly = enriched
    .filter(({ meta }) => meta.classification !== null && DISCOUNTED_GAME_CLASSIFICATIONS.has(meta.classification))
    .map(({ game }) => game)
    .filter((game) => Boolean(game.date))
  return paginate(sortByDate(gamesOnly, 'date-desc'), offset, size)
}

// Function-injection seam (AGENTS.md §3.2 / §13 forbid DI containers and
// Service classes). The optional fetcher defaults to the real boundary and is
// overridden only by tests with an in-memory fake (AGENTS.md §9).
type FetchProductDetail = typeof fetchProductDetail

const enrichGameWithDetail = async (
  game: Game,
  fetchDetail: FetchProductDetail,
): Promise<Game> => {
  try {
    const detail = await fetchDetail(game.id)
    return {
      ...game,
      date: detail.releaseDate ?? game.date,
      genres: detail.genres.length > 0 ? detail.genres : game.genres,
      description: detail.description || game.description,
      studio: detail.publisherName || game.studio,
    }
  } catch (error) {
    console.warn(`Product detail enrichment failed for ${game.id}`, error)
    return game
  }
}

export const getGameById = async (
  id: string,
  fetchDetail: FetchProductDetail = fetchProductDetail,
): Promise<Game> => {
  const cached = cache.get<Game>(detailCacheKey(id))
  if (cached) {
    return decodeGame(cached)
  }

  const games = await baseGames()
  const game = games.find((item) => item.id === id)

  if (game) {
    const enriched = await enrichGameWithDetail(game, fetchDetail)
    cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
    return decodeGame(enriched)
  }

  for (const feature of ['upcoming', 'discounted'] as const) {
    const featureGame = await findGameInFeatureConcepts(feature, id)
    if (featureGame) {
      const enriched = await enrichGameWithDetail(featureGame, fetchDetail)
      cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
      return decodeGame(enriched)
    }
  }

  throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
}
