import { gameSchema, pageResultSchema } from '@psstore/shared'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'
import {
  GameNotFound,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import {
  gameIdParamSchema,
  paginationQuerySchema,
  searchQuerySchema,
} from '../validation/schemas.js'

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

const searchEndpoint = HttpApiEndpoint.get('search', '/search', {
  query: searchQuerySchema,
  success: pageResultSchema,
  error: [HttpApiError.BadRequestNoContent, ...upstreamErrors],
})

const getByIdEndpoint = HttpApiEndpoint.get('getById', '/:id', {
  params: gameIdParamSchema,
  success: gameSchema,
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
    searchEndpoint,
    getByIdEndpoint,
  )
  .prefix('/api/games')

export const gamesApi = HttpApi.make('psstore').add(gamesGroup)

export type GamesApi = typeof gamesApi
