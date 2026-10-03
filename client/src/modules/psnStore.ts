import type { Game, GameDetail, PageResult } from '@psstore/shared'

const jsonHeaders = { Accept: 'application/json' }

export class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Request failed with status ${String(status)}`)
    this.name = 'HttpError'
    this.status = status
  }
}

const withSignal = (signal: AbortSignal | undefined): RequestInit =>
  signal === undefined ? {} : { signal }

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
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson(
    `/api/games/new?offset=${String(offset)}&size=${String(size)}`,
    withSignal(signal),
  )
export const fetchUpcomingGames = async (
  offset: number,
  size: number,
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson(
    `/api/games/upcoming?offset=${String(offset)}&size=${String(size)}`,
    withSignal(signal),
  )
export const fetchDiscountedGames = async (
  offset: number,
  size: number,
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson(
    `/api/games/discounted?offset=${String(offset)}&size=${String(size)}`,
    withSignal(signal),
  )
export const fetchMonthlyGames = async (
  offset: number,
  size: number,
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson(
    `/api/games/monthly?offset=${String(offset)}&size=${String(size)}`,
    withSignal(signal),
  )
export const fetchSearchGames = async (
  term: string,
  offset: number,
  size: number,
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson(
    `/api/games/search?q=${encodeURIComponent(term)}&offset=${String(offset)}&size=${String(size)}`,
    withSignal(signal),
  )
export const fetchGame = async (gameId: string): Promise<GameDetail> =>
  getJson(`/api/games/${encodeURIComponent(gameId)}`)

// Signed-in calls. The sign-in cookie is HttpOnly: the browser attaches it, the
// page never reads it. `no-store` keeps signed-in answers out of the HTTP cache.
export const fetchPurchasedGames = async (
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson('/api/games/purchased', {
    cache: 'no-store',
    credentials: 'same-origin',
    ...withSignal(signal),
  })

export const fetchWishlistGames = async (
  signal?: AbortSignal,
): Promise<PageResult> =>
  getJson('/api/games/wishlist', {
    cache: 'no-store',
    credentials: 'same-origin',
    ...withSignal(signal),
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

export type { Game, GameDetail, PageResult }
