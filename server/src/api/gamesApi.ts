import {
  gameDetailSchema,
  genreListSchema,
  pageResultSchema,
} from '@psstore/shared'
import { Context, Schema, type Redacted } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from 'effect/http-api'
import { NPSSO_COOKIE_NAME } from '../config/env.js'
import {
  GameNotFound,
  SessionRejected,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import {
  browseQuerySchema,
  gameIdParamSchema,
  paginationQuerySchema,
  searchQuerySchema,
} from '../validation/schemas.js'

// The sign-in cookie as a security scheme: the middleware below decodes it from
// the request. The credential is the user's NPSSO.
export const npssoSecurity = HttpApiSecurity.apiKey({
  key: NPSSO_COOKIE_NAME,
  in: 'cookie',
})

export class CurrentNpsso extends Context.Service<
  CurrentNpsso,
  Redacted.Redacted
>()('CurrentNpsso') {}

// Guards the signed-in routes. A missing or empty cookie is a 401 before any
// Sony call; the implementation lives in gamesHandlers.ts.
export class NpssoAuth extends HttpApiMiddleware.Service<
  NpssoAuth,
  {
    provides: CurrentNpsso
  }
>()('NpssoAuth', {
  security: { npsso: npssoSecurity },
  error: SessionRejected.pipe(HttpApiSchema.status(401)),
}) {}

// The typed REST surface. The endpoint schemas validate path / query at the
// boundary. A failed decode reaches the client as an empty 400 (runtime
// HttpApiSchemaError), not through the typed error channel; the 400 entries
// below declare that empty body in OpenAPI. The typed error channel maps each
// tagged error to its HTTP status (no hand-rolled error-to-response glue —
// STACK.md §8). This file is one of the
// exactly three modules permitted to import `effect/http-api` (enforced by the
// server-scoped no-restricted-imports lint rule).

const upstreamErrors = [
  UpstreamUnavailable.pipe(HttpApiSchema.status(502)),
  UpstreamQueryRotated.pipe(HttpApiSchema.status(502)),
  UpstreamRateLimited.pipe(HttpApiSchema.status(503)),
] as const

const listEndpoint = <const Name extends string>(name: Name) =>
  HttpApiEndpoint.get(name, `/${name}`, {
    query: paginationQuerySchema,
    success: pageResultSchema,
    error: [HttpApiError.BadRequestNoContent, ...upstreamErrors],
  })

// Signed-in lists are GET-only and read-only. Registered before `getById` so
// `/purchased` and `/wishlist` are never read as a game id.
const signedInEndpoint = <const Name extends string>(name: Name) =>
  HttpApiEndpoint.get(name, `/${name}`, {
    success: pageResultSchema,
    error: [SessionRejected.pipe(HttpApiSchema.status(401)), ...upstreamErrors],
  }).middleware(NpssoAuth)
const searchEndpoint = HttpApiEndpoint.get('search', '/search', {
  query: searchQuerySchema,
  success: pageResultSchema,
  error: [HttpApiError.BadRequestNoContent, ...upstreamErrors],
})

// BROWSE: Sony's genre list, and one genre in one Sony order. Registered before
// `getById` so `/genres` and `/browse` are never read as a game id.
const genresEndpoint = HttpApiEndpoint.get('genres', '/genres', {
  success: genreListSchema,
  error: upstreamErrors,
})

const browseEndpoint = HttpApiEndpoint.get('browse', '/browse', {
  query: browseQuerySchema,
  success: pageResultSchema,
  error: [HttpApiError.BadRequestNoContent, ...upstreamErrors],
})

const getByIdEndpoint = HttpApiEndpoint.get('getById', '/:id', {
  params: gameIdParamSchema,
  success: gameDetailSchema,
  error: [
    HttpApiError.BadRequestNoContent,
    GameNotFound.pipe(HttpApiSchema.status(404)),
    ...upstreamErrors,
  ],
})

export const gamesGroup = HttpApiGroup.make('games')
  .add(
    listEndpoint('new'),
    listEndpoint('upcoming'),
    listEndpoint('discounted'),
    listEndpoint('monthly'),
    signedInEndpoint('purchased'),
    signedInEndpoint('wishlist'),
    searchEndpoint,
    genresEndpoint,
    browseEndpoint,
    getByIdEndpoint,
  )
  .prefix('/api/games')

// The NPSSO is a full account credential: 16 to 512 characters from a
// cookie-safe set, so it can be stored in a cookie value verbatim.
const npssoSchema = Schema.RedactedFromValue(
  Schema.String.check(
    Schema.isMinLength(16),
    Schema.isMaxLength(512),
    Schema.isPattern(/^[A-Za-z0-9._~-]+$/),
  ),
)

// The sign-in cookie is set and cleared here. The body carries the NPSSO in and
// nothing out: no token and no NPSSO ever appears in a response body.
export const sessionGroup = HttpApiGroup.make('session')
  .add(
    HttpApiEndpoint.post('signIn', '/', {
      payload: Schema.Struct({ npsso: npssoSchema }),
      success: HttpApiSchema.NoContent,
      error: [
        HttpApiError.BadRequestNoContent,
        SessionRejected.pipe(HttpApiSchema.status(401)),
        ...upstreamErrors,
      ],
    }),
    HttpApiEndpoint.delete('signOut', '/', {
      success: HttpApiSchema.NoContent,
    }),
  )
  .prefix('/api/session')

export const gamesApi = HttpApi.make('psstore')
  .add(gamesGroup)
  .add(sessionGroup)

export type GamesApi = typeof gamesApi
