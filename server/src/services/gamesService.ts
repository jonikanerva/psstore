import { gameSchema, gamesSchema, type Game } from '@psstore/shared'
import { MemoryCache } from '../lib/cache.js'
import { HttpError } from '../errors/httpError.js'
import { env } from '../config/env.js'
import {
  fetchConceptsByFeature,
  fetchSearchGames,
  fetchProductReleaseDate,
} from '../sony/sonyClient.js'
import { conceptToGame, defaultDiscountDate, isConceptDiscounted, isConceptPlus } from '../sony/mapper.js'
import type { Concept } from '../sony/types.js'

const cache = new MemoryCache()
const MIN_ITEMS = 24
const LIST_PAGE_SIZE = 120
const RELEASE_DATE_CONCURRENCY = 2
const RELEASE_DATE_TTL_MS = 6 * 60 * 60 * 1000

const withCache = async <T>(key: string, resolve: () => Promise<T>): Promise<T> => {
  const hit = cache.get<T>(key)
  if (hit) {
    return hit
  }

  const value = await resolve()
  cache.set(key, value, env.CACHE_TTL_MS)
  return value
}

const sortByDateDesc = (games: Game[]): Game[] =>
  [...games].sort((a, b) => {
    const aTs = a.date ? Date.parse(a.date) : Number.NaN
    const bTs = b.date ? Date.parse(b.date) : Number.NaN
    const aValid = Number.isFinite(aTs)
    const bValid = Number.isFinite(bTs)

    if (aValid && bValid) {
      return bTs - aTs
    }

    if (aValid && !bValid) {
      return -1
    }

    if (!aValid && bValid) {
      return 1
    }

    return 0
  })

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

export const getNewGames = async (): Promise<Game[]> => {
  const games = await baseGames()
  const now = Date.now()
  return sortByDateDesc(games.filter((game) => isReleased(game, now)))
}

export const getUpcomingGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const primary = await mapConceptsToGames(await featureConcepts('upcoming'))
  return sortByDateAsc(primary.filter((game) => isUpcoming(game, now)))
}

export const getDiscountedGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const primaryConcepts = await featureConcepts('discounted')
  const discounted = await mapConceptsToGames(
    primaryConcepts.filter((concept) => isConceptDiscounted(concept)),
  )
  return sortByDateDesc(
    discounted.filter((game) => game.discountDate !== defaultDiscountDate && isReleased(game, now)),
  )
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
    return base.slice(0, MIN_ITEMS)
  }

  const primary = await withCache(`search-${normalized}`, async () => {
    try {
      return gamesSchema.parse(await fetchSearchGames(normalized, 60))
    } catch (error) {
      console.warn('Search query failed; using fallback results from base feed', error)
      return []
    }
  })

  const fallback = sortByDateDesc(base.filter((game) => game.name.toLowerCase().includes(normalized)))
  return ensureNonEmpty(primary, fallback, base)
}

export const getGameById = async (id: string): Promise<Game> => {
  const games = await baseGames()
  const game = games.find((item) => item.id === id)

  if (!game) {
    throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
  }

  return gameSchema.parse(game)
}
