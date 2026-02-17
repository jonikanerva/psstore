import type { Game, PageResult } from '@psstore/shared'

const jsonHeaders = { Accept: 'application/json' }

const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: jsonHeaders })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export const fetchNewGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/new?offset=${offset}&size=${size}`)
export const fetchUpcomingGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/upcoming?offset=${offset}&size=${size}`)
export const fetchDiscountedGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/discounted?offset=${offset}&size=${size}`)
export const fetchPlusGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/plus?offset=${offset}&size=${size}`)
export const fetchGame = async (gameId: string): Promise<Game> =>
  getJson(`/api/games/${encodeURIComponent(gameId)}`)

export const metacriticLink = (name: string): string =>
  `https://www.metacritic.com/search/game/${encodeURI(
    name,
  )}/results?plats%5B72496%5D=1&search_type=advanced&sort=recent`

export type { Game, PageResult }
