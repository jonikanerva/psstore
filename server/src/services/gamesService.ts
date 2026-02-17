import { gameSchema, gamesSchema, sortByDateDesc, type Game } from '@psstore/shared'
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
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000

const withCache = async <T>(key: string, resolve: () => Promise<T>): Promise<T> => {
  const hit = cache.get<T>(key)
  if (hit) {
    return hit
  }

  const value = await resolve()
  cache.set(key, value, env.CACHE_TTL_MS)
  return value
}

const sortByDateAsc = (games: Game[]): Game[] =>
  [...games].sort((a, b) => {
    const aTs = Date.parse(a.date)
    const bTs = Date.parse(b.date)
    return aTs - bTs
  })

const toTimestamp = (value: string): number | null => {
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

const isReleased = (game: Game, now: number): boolean => {
  const ts = toTimestamp(game.date)
  return ts !== null && ts <= now
}

const isUpcoming = (game: Game, now: number): boolean => {
  const ts = toTimestamp(game.date)
  return ts !== null && ts > now
}

const mapConceptsToGames = (concepts: Concept[]): Game[] => {
  const mapped = concepts
    .map((concept) => conceptToGame(concept))
    .filter((game) => Boolean(game.id || game.name))

  return gamesSchema.parse(mapped)
}

const detailCacheKey = (id: string): string => `game-detail:${id}`

const baseConcepts = async (): Promise<Concept[]> =>
  withCache('concepts-new', async () => fetchConceptsByFeature('new', LIST_PAGE_SIZE))

const baseGames = async (): Promise<Game[]> =>
  withCache('games-new', async () => sortByDateDesc(mapConceptsToGames(await baseConcepts())))

const featureConcepts = async (feature: 'upcoming' | 'discounted' | 'plus'): Promise<Concept[]> =>
  withCache(`concepts-${feature}`, async () => {
    try {
      return await fetchConceptsByFeature(feature, LIST_PAGE_SIZE)
    } catch (error) {
      console.warn(`Feature query failed for ${feature}; using base fallback`, error)
      return []
    }
  })

const conceptProductId = (concept: Concept): string => concept.products?.[0]?.id ?? concept.id ?? ''

const findGameInFeatureConcepts = async (
  feature: 'upcoming' | 'discounted' | 'plus',
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

const logFilterStats = (route: string, candidates: number, result: number): void => {
  console.info(JSON.stringify({
    route,
    candidates,
    excludedMissingDate: candidates - result,
    result,
  }))
}

export const getNewGames = async (): Promise<Game[]> => {
  const games = await baseGames()
  const now = Date.now()
  const result = sortByDateDesc(games.filter((game) => isReleased(game, now)))
  logFilterStats('new', games.length, result.length)
  return result
}

export const getUpcomingGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const primary = mapConceptsToGames(await featureConcepts('upcoming'))
  const result = sortByDateAsc(primary.filter((game) => isUpcoming(game, now)))
  logFilterStats('upcoming', primary.length, result.length)
  return result
}

export const getDiscountedGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const primaryConcepts = await featureConcepts('discounted')
  const all = mapConceptsToGames(primaryConcepts)
  const result = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('discounted', all.length, result.length)
  return result
}

export const getPlusGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const all = mapConceptsToGames(await featureConcepts('plus'))
  const result = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('plus', all.length, result.length)
  return result
}

const enrichGameWithDetail = async (game: Game): Promise<Game> => {
  try {
    const detail = await fetchProductDetail(game.id)
    return {
      ...game,
      date: detail.releaseDate ?? game.date,
      genres: detail.genres.length > 0 ? detail.genres : game.genres,
      description: detail.description || game.description,
    }
  } catch (error) {
    console.warn(`Product detail enrichment failed for ${game.id}`, error)
    return game
  }
}

export const getGameById = async (id: string): Promise<Game> => {
  const cached = cache.get<Game>(detailCacheKey(id))
  if (cached) {
    return gameSchema.parse(cached)
  }

  const games = await baseGames()
  const game = games.find((item) => item.id === id)

  if (game) {
    const enriched = await enrichGameWithDetail(game)
    cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
    return gameSchema.parse(enriched)
  }

  for (const feature of ['upcoming', 'discounted', 'plus'] as const) {
    const featureGame = await findGameInFeatureConcepts(feature, id)
    if (featureGame) {
      const enriched = await enrichGameWithDetail(featureGame)
      cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
      return gameSchema.parse(enriched)
    }
  }

  throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
}
