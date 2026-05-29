import { gameSchema, gamesSchema, type Game, type PageResult } from '@psstore/shared'
import { MemoryCache } from '../lib/cache.js'
import { HttpError } from '../errors/httpError.js'
import { env } from '../config/env.js'
import {
  fetchConceptsByFeature,
  fetchProductDetail,
} from '../sony/sonyClient.js'
import { conceptToGame } from '../sony/mapper.js'
import type { Concept } from '../sony/types.js'

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

const PRODUCT_ID_PATTERN = /^[A-Z]{2}\d{4}-[A-Z]{4}\d{5}_00-/

const isValidProductId = (id: string): boolean => PRODUCT_ID_PATTERN.test(id)

const withCache = async <T>(key: string, resolve: () => Promise<T>): Promise<T> => {
  const hit = cache.get<T>(key)
  if (hit) {
    return hit
  }

  const value = await resolve()
  cache.set(key, value, env.CACHE_TTL_MS)
  return value
}

type SortOrder = 'date-desc' | 'date-asc'

// Unparseable / missing dates sort last (most distant in the requested
// direction) rather than producing NaN comparisons, which would make the sort
// implementation-defined.
const DATE_DESC_SENTINEL = Number.NEGATIVE_INFINITY
const DATE_ASC_SENTINEL = Number.POSITIVE_INFINITY

/**
 * Sort enriched games by per-product release date, falling back to the upstream
 * order (the server's `conceptReleaseDate`-desc grid order) as a STABLE
 * tiebreaker. Without this, equal or unparseable dates reorder
 * nondeterministically across requests; the tiebreaker keeps the official
 * grid order Sony already returns for ties (see the spike doc, section B).
 */
const sortByDate = (games: Game[], order: SortOrder): Game[] => {
  const sentinel = order === 'date-desc' ? DATE_DESC_SENTINEL : DATE_ASC_SENTINEL
  const tsOf = (game: Game): number => {
    const parsed = Date.parse(game.date)
    return Number.isNaN(parsed) ? sentinel : parsed
  }

  return games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => {
      const aTs = tsOf(a.game)
      const bTs = tsOf(b.game)
      const byDate = order === 'date-desc' ? bTs - aTs : aTs - bTs
      return byDate !== 0 ? byDate : a.index - b.index
    })
    .map((entry) => entry.game)
}

const paginate = (games: Game[], offset: number, size: number): PageResult => {
  const page = games.slice(offset, offset + size)
  const nextOffset = offset + size < games.length ? offset + size : null
  return { games: page, totalCount: games.length, nextOffset }
}

const mapConceptsToGames = (concepts: Concept[]): Game[] => {
  const mapped = concepts
    .map((concept) => conceptToGame(concept))
    .filter((game) => Boolean(game.id) && isValidProductId(game.id))

  return gamesSchema.parse(mapped)
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

// Allow-list of Sony `storeDisplayClassification` values that are full games.
// Conservative by design: unknown / future classifications are excluded so a
// new non-game SKU type can never silently leak into the games-only grid.
// PREMIUM_EDITION is excluded for edition de-duplication (AGENTS.md §14.1);
// including it would be a one-line addition here.
const DISCOUNTED_GAME_CLASSIFICATIONS = new Set(['FULL_GAME', 'GAME_BUNDLE'])

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

const conceptProductId = (concept: Concept): string => concept.products?.[0]?.id ?? concept.id ?? ''

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

type DateFilter = 'released' | 'upcoming' | 'none'

const applyDateFilter = (games: Game[], filter: DateFilter): Game[] => {
  if (filter === 'none') return games
  const now = Date.now()
  return games.filter((game) => {
    const ts = Date.parse(game.date)
    return filter === 'released' ? ts <= now : ts > now
  })
}

const enrichedListing = async (
  gamesPromise: Promise<Game[]> | Game[],
  order: SortOrder,
  dateFilter: DateFilter,
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

// UPCOMING uses DateFilter 'none': the `next_thirty_days` facet
// (queryStrategies.ts) already bounds the window upstream. The previous
// per-product `> now` re-filter stranded trailing-edge survivors — concepts
// inside the facet window whose enriched date had just slipped into the past
// between the grid snapshot and enrichment (live: 7 of 12 dropped). The facet
// is the authoritative window; we keep `enrichGamesWithDates`' empty-date drop
// (correctly excludes the ~41/53 announced concepts with `products: []` /
// `price: null` that the PRODUCT_ID_PATTERN already filters), giving a ~12
// SKU-bearing ceiling.
export const getUpcomingGames = async (offset = 0, size = 60): Promise<PageResult> =>
  enrichedListing(mapConceptsToGames(await featureConcepts('upcoming')), 'date-asc', 'none', offset, size)

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
    return gameSchema.parse(cached)
  }

  const games = await baseGames()
  const game = games.find((item) => item.id === id)

  if (game) {
    const enriched = await enrichGameWithDetail(game, fetchDetail)
    cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
    return gameSchema.parse(enriched)
  }

  for (const feature of ['upcoming', 'discounted'] as const) {
    const featureGame = await findGameInFeatureConcepts(feature, id)
    if (featureGame) {
      const enriched = await enrichGameWithDetail(featureGame, fetchDetail)
      cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
      return gameSchema.parse(enriched)
    }
  }

  throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
}
