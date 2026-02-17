import type { Game } from '@psstore/shared'

const jsonHeaders = { Accept: 'application/json' }

const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: jsonHeaders })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export const fetchNewGames = async (): Promise<Game[]> => getJson('/api/games/new')
export const fetchUpcomingGames = async (): Promise<Game[]> =>
  getJson('/api/games/upcoming')
export const fetchDiscountedGames = async (): Promise<Game[]> =>
  getJson('/api/games/discounted')
export const fetchPlusGames = async (): Promise<Game[]> => getJson('/api/games/plus')
export const fetchGame = async (gameId: string): Promise<Game> =>
  getJson(`/api/games/${encodeURIComponent(gameId)}`)

export const metacriticLink = (name: string): string =>
  `https://www.metacritic.com/search/game/${encodeURI(
    name,
  )}/results?plats%5B72496%5D=1&search_type=advanced&sort=recent`

export type { Game }
