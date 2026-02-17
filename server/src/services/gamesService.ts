import { gameSchema, gamesSchema, sortByDateDesc, type Game } from '@psstore/shared'
import { MemoryCache } from '../lib/cache.js'
import { HttpError } from '../errors/httpError.js'
import { env } from '../config/env.js'
import {
  fetchConceptsByFeature,
  fetchSearchConcepts,
  fetchProductReleaseDate,
  fetchProductDetail,
} from '../sony/sonyClient.js'
import { conceptToGame, defaultDiscountDate, isConceptDiscounted, isConceptPlus } from '../sony/mapper.js'
import type { Concept } from '../sony/types.js'

const cache = new MemoryCache()
const MIN_ITEMS = 24
const LIST_PAGE_SIZE = 120
const RELEASE_DATE_CONCURRENCY = 2
const RELEASE_DATE_TTL_MS = 6 * 60 * 60 * 1000
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

const withProductReleaseDates = async (
  games: Game[],
  discountedIds: Set<string>,
): Promise<Game[]> => {
  const uniqueIds = Array.from(new Set(games.map((game) => game.id).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return games
  }

  const releaseDateById = new Map<string, string>()
  let nextIndex = 0

  const workers = Array.from(
    { length: Math.min(RELEASE_DATE_CONCURRENCY, uniqueIds.length) },
    async () => {
      while (nextIndex < uniqueIds.length) {
        const id = uniqueIds[nextIndex]
        nextIndex += 1

        const cacheKey = `release-date:${id}`
        const cached = cache.get<{ value: string }>(cacheKey)
        if (cached) {
          releaseDateById.set(id, cached.value)
          continue
        }

        let resolvedDate = ''
        try {
          resolvedDate = (await fetchProductReleaseDate(id)) ?? ''
        } catch (error) {
          console.warn(`Product release date lookup failed for ${id}`, error)
        }

        cache.set(cacheKey, { value: resolvedDate }, RELEASE_DATE_TTL_MS)
        releaseDateById.set(id, resolvedDate)
      }
    },
  )

  await Promise.all(workers)

  return games.map((game) => {
    const releaseDate = releaseDateById.get(game.id) ?? game.date
    if (!releaseDate) {
      return game
    }

    return {
      ...game,
      date: releaseDate,
      discountDate:
        discountedIds.has(game.id) && game.discountDate === defaultDiscountDate
          ? releaseDate
          : game.discountDate,
      preOrder: Date.parse(releaseDate) > Date.now(),
    }
  })
}

const mapConceptsToGames = async (concepts: Concept[]): Promise<Game[]> => {
  const discountedIds = new Set<string>()
  const mapped = concepts
    .map((concept) => {
      const game = conceptToGame(concept)
      if (isConceptDiscounted(concept) && game.id) {
        discountedIds.add(game.id)
      }
      return game
    })
    .filter((game) => Boolean(game.id || game.name))

  const baseGames = gamesSchema.parse(mapped)
  return withProductReleaseDates(baseGames, discountedIds)
}

const ensureNonEmpty = (primary: Game[], fallback: Game[], base: Game[]): Game[] => {
  if (primary.length > 0) {
    return primary
  }

  if (fallback.length > 0) {
    return fallback
  }

  return base.slice(0, MIN_ITEMS)
}

const detailCacheKey = (id: string): string => `game-detail:${id}`

const rememberGamesForDetail = (games: Game[]): void => {
  for (const game of games) {
    if (!game.id) {
      continue
    }
    cache.set(detailCacheKey(game.id), game, DETAIL_TTL_MS)
  }
}

const baseConcepts = async (): Promise<Concept[]> =>
  withCache('concepts-new', async () => fetchConceptsByFeature('new', LIST_PAGE_SIZE))

const baseGames = async (): Promise<Game[]> =>
  withCache('games-new', async () => sortByDateDesc(await mapConceptsToGames(await baseConcepts())))

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

  const games = await mapConceptsToGames(matchingConcepts)
  return games.find((game) => game.id === id) ?? null
}

const findGameInSearchResults = async (id: string): Promise<Game | null> => {
  const matches = await withCache(`search-id-${id}`, async () => {
    try {
      return await mapConceptsToGames(await fetchSearchConcepts(id, 60))
    } catch (error) {
      console.warn(`Search lookup failed for detail id ${id}`, error)
      return []
    }
  })

  return matches.find((game) => game.id === id) ?? null
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
  const primary = await mapConceptsToGames(await featureConcepts('upcoming'))
  const result = sortByDateAsc(primary.filter((game) => isUpcoming(game, now)))
  logFilterStats('upcoming', primary.length, result.length)
  return result
}

export const getDiscountedGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const primaryConcepts = await featureConcepts('discounted')
  const all = await mapConceptsToGames(primaryConcepts)
  const result = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('discounted', all.length, result.length)
  return result
}

export const getPlusGames = async (): Promise<Game[]> => {
  const base = await baseGames()
  const primaryConcepts = await featureConcepts('plus')
  const primary = sortByDateDesc(
    await mapConceptsToGames(primaryConcepts.filter((concept) => isConceptPlus(concept))),
  )

  const fallback = sortByDateDesc(
    await mapConceptsToGames(await baseConcepts().then((concepts) => concepts.filter(isConceptPlus))),
  )
  return ensureNonEmpty(primary, fallback, base)
}

export const searchGames = async (query: string): Promise<Game[]> => {
  const base = await baseGames()
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    const results = base.slice(0, MIN_ITEMS)
    rememberGamesForDetail(results)
    return results
  }

  const primary = await withCache(`search-${normalized}`, async () => {
    try {
      return await mapConceptsToGames(await fetchSearchConcepts(normalized, 60))
    } catch (error) {
      console.warn('Search query failed; using fallback results from base feed', error)
      return []
    }
  })

  const fallback = sortByDateDesc(base.filter((game) => game.name.toLowerCase().includes(normalized)))
  const results = primary.length > 0 ? primary : fallback
  rememberGamesForDetail(results)
  return results
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
    return gameSchema.parse(await enrichGameWithDetail(cached))
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

  const searchGame = await findGameInSearchResults(id)
  if (searchGame) {
    const enriched = await enrichGameWithDetail(searchGame)
    cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
    return gameSchema.parse(enriched)
  }

  throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
}
