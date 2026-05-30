import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform'
import { gameSchema, pageResultSchema } from '@psstore/shared'
import {
  GameNotFound,
  UpstreamUnavailable,
  ValidationError,
} from '../errors/errors.js'
import {
  gameIdParamSchema,
  paginationQuerySchema,
} from '../validation/schemas.js'

// The typed REST surface. The endpoint schemas validate path / query at the
// boundary; the typed error channel maps each tagged error to its HTTP status
// (no hand-rolled error-to-response glue — STACK.md §8). This file is one of the
// exactly three modules permitted to import `@effect/platform` (enforced by the
// server-scoped no-restricted-imports lint rule).

const listEndpoint = <const Name extends string>(name: Name) =>
  HttpApiEndpoint.get(name, `/${name}`)
    .setUrlParams(paginationQuerySchema)
    .addSuccess(pageResultSchema)
    .addError(ValidationError, { status: 400 })
    .addError(UpstreamUnavailable, { status: 502 })

const getByIdEndpoint = HttpApiEndpoint.get('getById', '/:id')
  .setPath(gameIdParamSchema)
  .addSuccess(gameSchema)
  .addError(ValidationError, { status: 400 })
  .addError(GameNotFound, { status: 404 })
  .addError(UpstreamUnavailable, { status: 502 })

export const gamesGroup = HttpApiGroup.make('games')
  .add(listEndpoint('new'))
  .add(listEndpoint('upcoming'))
  .add(listEndpoint('discounted'))
  .add(getByIdEndpoint)
  .prefix('/api/games')

export const gamesApi = HttpApi.make('psstore').add(gamesGroup)

export type GamesApi = typeof gamesApi
