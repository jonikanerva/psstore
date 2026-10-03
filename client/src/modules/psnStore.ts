import type { Game, PageResult } from '@psstore/shared'

const jsonHeaders = { Accept: 'application/json' }

export class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Request failed with status ${String(status)}`)
    this.name = 'HttpError'
    this.status = status
  }
}

const getJson = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, { headers: jsonHeaders, ...init })
  if (!response.ok) {
    throw new HttpError(response.status)
  }

  return (await response.json()) as T
}

export const fetchNewGames = async (
  offset: number,
  size: number,
): Promise<PageResult> =>
  getJson(`/api/games/new?offset=${String(offset)}&size=${String(size)}`)
export const fetchUpcomingGames = async (
  offset: number,
  size: number,
): Promise<PageResult> =>
  getJson(`/api/games/upcoming?offset=${String(offset)}&size=${String(size)}`)
export const fetchDiscountedGames = async (
  offset: number,
  size: number,
): Promise<PageResult> =>
  getJson(`/api/games/discounted?offset=${String(offset)}&size=${String(size)}`)
export const fetchMonthlyGames = async (
  offset: number,
  size: number,
): Promise<PageResult> =>
  getJson(`/api/games/monthly?offset=${String(offset)}&size=${String(size)}`)
export const fetchSearchGames = async (
  term: string,
  offset: number,
  size: number,
): Promise<PageResult> =>
  getJson(
    `/api/games/search?q=${encodeURIComponent(term)}&offset=${String(offset)}&size=${String(size)}`,
  )
export const fetchGame = async (gameId: string): Promise<Game> =>
  getJson(`/api/games/${encodeURIComponent(gameId)}`)

// Signed-in calls. The sign-in cookie is HttpOnly: the browser attaches it, the
// page never reads it. `no-store` keeps signed-in answers out of the HTTP cache.
export const fetchPurchasedGames = async (): Promise<PageResult> =>
  getJson('/api/games/purchased', {
    cache: 'no-store',
    credentials: 'same-origin',
  })

export const signIn = async (npsso: string): Promise<void> => {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npsso }),
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new HttpError(response.status)
  }
}

export const signOut = async (): Promise<void> => {
  const response = await fetch('/api/session', {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new HttpError(response.status)
  }
}

export const metacriticLink = (name: string): string =>
  `https://www.metacritic.com/search/${encodeURIComponent(name)}/`

export type { Game, PageResult }
