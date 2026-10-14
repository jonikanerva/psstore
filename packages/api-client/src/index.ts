// The handwritten facade of the generated API client. The web app calls the
// API only through these functions.
//
// - The generated SDK validates every success body with the generated Zod
//   schema before a function returns it. `parseAs: 'json'` makes the SDK
//   parse every success body as JSON, so a body with another content type
//   also goes through the validator.
// - The SDK does not validate error bodies. `toFailure` validates them with
//   the generated Problem schema.
// - A failure with an HTTP response becomes an `ApiError` with the status
//   and a code. A failure without a response (network, abort) keeps its
//   original error, so an abort before the response headers stays an
//   `AbortError`. An abort while the body is read becomes an `ApiError`:
//   `invalid_response` for a success status, `unrecognized_error` for an
//   error status.
//
// Never edit `./generated`: run `pnpm --filter @psstore/api-client run
// generate` after a change to `contract/openapi.json`.
//
// The first import turns off Zod's `eval` use before any schema exists.
import './zodConfig.js'
import { createClient, createConfig } from './generated/client/index.js'
import type { Client } from './generated/client/index.js'
import * as sdk from './generated/sdk.gen.js'
import type {
  BrowseOrder,
  GameDetail,
  GenreList,
  PageResult,
  ProblemCode,
} from './generated/types.gen.js'
import { zBrowseOrder, zGenre, zProblem } from './generated/zod.gen.js'

export type {
  BrowseOrder,
  Game,
  GameDetail,
  Genre,
  GenreList,
  IdKind,
  PageResult,
  PlusOffer,
  Problem,
  ProblemCode,
} from './generated/types.gen.js'

// The HTTP status of each known problem code. `satisfies` makes the table
// exhaustive: a new code in the contract fails the type check until it has a
// row. A problem whose code and HTTP status disagree is not trusted.
const PROBLEM_STATUS = {
  invalid_request: 400,
  not_found: 404,
  game_not_found: 404,
  session_rejected: 401,
  unsupported_media_type: 415,
  payload_too_large: 413,
  upstream_unavailable: 502,
  upstream_query_rotated: 502,
  upstream_rate_limited: 503,
  internal_error: 500,
} as const satisfies Record<ProblemCode, number>

export const problemStatus = (code: ProblemCode): number => PROBLEM_STATUS[code]

// `invalid_response`: a success status with a body that breaks the contract.
// `unrecognized_error`: a failure status without a known problem body, for
// example an unknown code, an invalid body, or the HTML page of a proxy.
export type ApiErrorCode =
  ProblemCode | 'invalid_response' | 'unrecognized_error'

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly status: number
  readonly code: ApiErrorCode
  // Only for `upstream_rate_limited`: Sony's delay in seconds, when given.
  readonly retryAfterSeconds: number | undefined

  constructor(
    status: number,
    code: ApiErrorCode,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(`API request failed with status ${String(status)} (${code})`, {
      cause: options.cause,
    })
    this.status = status
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

// The problem of a failure body, or `undefined` when the body is not a known
// problem of this status.
const knownProblem = (status: number, body: unknown) => {
  const parsed = zProblem.safeParse(body)
  if (!parsed.success || PROBLEM_STATUS[parsed.data.code] !== status) {
    return undefined
  }
  return parsed.data
}

// The error of a failed call. `body` is the parsed JSON body, the text of a
// non-JSON body, or a thrown error.
const toFailure = (body: unknown, response: Response | undefined): Error => {
  if (response === undefined) {
    return body instanceof Error
      ? body
      : new Error('The API request failed without an HTTP response.', {
          cause: body,
        })
  }
  if (response.ok) {
    return new ApiError(response.status, 'invalid_response', { cause: body })
  }
  const problem = knownProblem(response.status, body)
  if (problem === undefined) {
    return new ApiError(response.status, 'unrecognized_error')
  }
  return new ApiError(
    response.status,
    problem.code,
    problem.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: problem.retryAfterSeconds },
  )
}

// The result of an SDK call. The error is whatever the call produced, so
// `toFailure` treats it as unknown.
type Success<T> = { data: T; error: undefined }
type SdkResult<T> = (Success<T> | { data: undefined; error: unknown }) & {
  response?: Response
}

// The client sets `error` on every failure, to `{}` at least, so a result
// without `error` is a success.
const isSuccess = <T>(
  result: SdkResult<T>,
): result is SdkResult<T> & Success<T> => result.error === undefined

// True when the client returned a success without reading a body. The SDK
// then skips its validator and returns `{}`: it does so for a 204 and for a
// `Content-Length: 0` answer.
const skippedBody = (response: Response | undefined): boolean =>
  response === undefined ||
  response.status === 204 ||
  response.headers.get('Content-Length') === '0'

// The validated body of a call that answers with JSON. Each caller names `T`:
// an inferred `T` would also take `undefined` from the failure branch.
const unwrap = async <T>(pending: Promise<SdkResult<T>>): Promise<T> => {
  const result = await pending
  if (!isSuccess(result)) {
    throw toFailure(result.error, result.response)
  }
  if (skippedBody(result.response)) {
    throw new ApiError(result.response?.status ?? 0, 'invalid_response')
  }
  return result.data
}

// The outcome of a call that answers 204 without a body.
const unwrapEmpty = async (
  pending: Promise<SdkResult<unknown>>,
): Promise<void> => {
  const result = await pending
  if (!isSuccess(result)) {
    throw toFailure(result.error, result.response)
  }
}

export interface ApiConfig {
  // The origin of the API, read for each request.
  readonly baseUrl: () => string
  // The fetch implementation. The default is the global `fetch` at the time
  // of the request.
  readonly fetch?: typeof globalThis.fetch
}

// The signed-in calls bypass the HTTP cache and send the HttpOnly sign-in
// cookie, which the browser attaches. Script never reads or writes it.
const SIGNED_IN = { cache: 'no-store', credentials: 'same-origin' } as const

export const createApi = (config: ApiConfig) => {
  const client: Client = createClient(createConfig())
  const options = (signal?: AbortSignal) => ({
    client,
    baseUrl: config.baseUrl(),
    parseAs: 'json' as const,
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    ...(signal === undefined ? {} : { signal }),
  })

  return {
    fetchNewGames: (offset: number, size: number, signal?: AbortSignal) =>
      unwrap<PageResult>(
        sdk.listNewGames({ ...options(signal), query: { offset, size } }),
      ),
    fetchUpcomingGames: (offset: number, size: number, signal?: AbortSignal) =>
      unwrap<PageResult>(
        sdk.listUpcomingGames({ ...options(signal), query: { offset, size } }),
      ),
    fetchDiscountedGames: (
      offset: number,
      size: number,
      signal?: AbortSignal,
    ) =>
      unwrap<PageResult>(
        sdk.listDiscountedGames({
          ...options(signal),
          query: { offset, size },
        }),
      ),
    fetchMonthlyGames: (offset: number, size: number, signal?: AbortSignal) =>
      unwrap<PageResult>(
        sdk.listMonthlyGames({ ...options(signal), query: { offset, size } }),
      ),
    fetchSearchGames: (
      term: string,
      offset: number,
      size: number,
      signal?: AbortSignal,
    ) =>
      unwrap<PageResult>(
        sdk.searchGames({
          ...options(signal),
          query: { q: term, offset, size },
        }),
      ),
    fetchGenres: (signal?: AbortSignal) =>
      unwrap<GenreList>(sdk.listGenres(options(signal))),
    fetchBrowseGames: (
      genre: string,
      order: BrowseOrder,
      offset: number,
      size: number,
      signal?: AbortSignal,
    ) =>
      unwrap<PageResult>(
        sdk.browseGames({
          ...options(signal),
          query: { genre, order, offset, size },
        }),
      ),
    fetchGame: (gameId: string, signal?: AbortSignal) =>
      unwrap<GameDetail>(
        sdk.getGame({ ...options(signal), path: { id: gameId } }),
      ),
    fetchPurchasedGames: (signal?: AbortSignal) =>
      unwrap<PageResult>(
        sdk.listPurchasedGames({ ...options(signal), ...SIGNED_IN }),
      ),
    fetchWishlistGames: (signal?: AbortSignal) =>
      unwrap<PageResult>(
        sdk.listWishlistGames({ ...options(signal), ...SIGNED_IN }),
      ),
    signIn: (npsso: string): Promise<void> =>
      unwrapEmpty(sdk.signIn({ ...options(), ...SIGNED_IN, body: { npsso } })),
    signOut: (): Promise<void> =>
      unwrapEmpty(sdk.signOut({ ...options(), ...SIGNED_IN })),
  }
}

export type Api = ReturnType<typeof createApi>

// The page origin in a browser. Without a page, the URL stays relative.
const pageOrigin = (): string =>
  typeof location === 'undefined' ? '' : location.origin

const api = createApi({ baseUrl: pageOrigin })

export const {
  fetchNewGames,
  fetchUpcomingGames,
  fetchDiscountedGames,
  fetchMonthlyGames,
  fetchSearchGames,
  fetchGenres,
  fetchBrowseGames,
  fetchGame,
  fetchPurchasedGames,
  fetchWishlistGames,
  signIn,
  signOut,
} = api

// The BROWSE orders of the contract, in contract order.
export const BROWSE_ORDERS: readonly BrowseOrder[] = zBrowseOrder.options

export const isBrowseOrder = (value: unknown): value is BrowseOrder =>
  zBrowseOrder.safeParse(value).success

// True for a value of the Sony genre key format of the contract.
export const isGenreKey = (value: string): boolean =>
  zGenre.shape.key.safeParse(value).success
