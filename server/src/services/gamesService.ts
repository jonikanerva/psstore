import { gameSchema, gamesSchema, type Game } from '@psstore/shared'
import { env } from '../config/env.js'
import { MemoryCache } from '../lib/cache.js'
import { fetchCategoryGrid } from '../sony/sonyClient.js'
import { defaultDiscountDate, productToGame } from '../sony/mapper.js'
import { HttpError } from '../errors/httpError.js'

const cache = new MemoryCache()

const withCache = async (key: string, resolve: () => Promise<Game[]>): Promise<Game[]> => {
  const hit = cache.get<Game[]>(key)
  if (hit) {
    return hit
  }

  const games = await resolve()
  cache.set(key, games, env.CACHE_TTL_MS)
  return games
}

const sortByDateDesc = (games: Game[]): Game[] =>
  [...games].sort((a, b) => (a.date < b.date ? 1 : -1))

const allGames = async (): Promise<Game[]> =>
  withCache('all-games', async () => {
    const products = await fetchCategoryGrid(300)
    return gamesSchema.parse(products.map(productToGame))
  })

export const getNewGames = async (): Promise<Game[]> => {
  const games = await allGames()
  return sortByDateDesc(games.filter((game) => !game.preOrder))
}

export const getUpcomingGames = async (): Promise<Game[]> => {
  const games = await allGames()
  return sortByDateDesc(games.filter((game) => game.preOrder))
}

export const getDiscountedGames = async (): Promise<Game[]> => {
  const games = await allGames()
  return sortByDateDesc(games.filter((game) => game.discountDate !== defaultDiscountDate))
}

export const getPlusGames = async (): Promise<Game[]> => {
  const games = await allGames()
  return sortByDateDesc(games.filter((game) => /plus|ps\s*plus/i.test(game.studio)))
}

export const searchGames = async (query: string): Promise<Game[]> => {
  const games = await allGames()
  const normalized = query.toLowerCase()
  return sortByDateDesc(games.filter((game) => game.name.toLowerCase().includes(normalized)))
}

export const getGameById = async (id: string): Promise<Game> => {
  const games = await allGames()
  const game = games.find((item) => item.id === id)

  if (!game) {
    throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
  }

  return gameSchema.parse(game)
}
