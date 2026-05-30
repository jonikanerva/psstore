import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'
import { GamesService } from '../services/gamesService.js'
import { gamesApi } from './gamesApi.js'

// Thin handlers: take decoded input, call the GamesService, return its Effect.
// The typed error channel (GameNotFound / UpstreamUnavailable / ValidationError)
// is mapped to HTTP status by the endpoint definitions in gamesApi.ts. One of
// the three modules permitted to import `@effect/platform`.

export const gamesGroupLive = HttpApiBuilder.group(
  gamesApi,
  'games',
  (handlers) =>
    Effect.gen(function* () {
      const games = yield* GamesService
      return handlers
        .handle('new', ({ urlParams }) =>
          games.getNewGames(urlParams.offset, urlParams.size),
        )
        .handle('upcoming', ({ urlParams }) =>
          games.getUpcomingGames(urlParams.offset, urlParams.size),
        )
        .handle('discounted', ({ urlParams }) =>
          games.getDiscountedGames(urlParams.offset, urlParams.size),
        )
        .handle('getById', ({ path }) => games.getGameById(path.id))
    }),
)
