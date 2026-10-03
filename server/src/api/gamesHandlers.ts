import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { GamesService } from '../services/gamesService.js'
import { gamesApi } from './gamesApi.js'

// Thin handlers: take decoded input, call the GamesService, return its Effect.
// The typed error channel (GameNotFound / UpstreamUnavailable)
// is mapped to HTTP status by the endpoint definitions in gamesApi.ts. One of
// the three modules permitted to import `effect/http-api`.

export const gamesGroupLive = HttpApiBuilder.group(
  gamesApi,
  'games',
  (handlers) =>
    Effect.gen(function* () {
      const games = yield* GamesService
      return handlers.handleAll({
        new: ({ query }) => games.getNewGames(query.offset, query.size),
        upcoming: ({ query }) =>
          games.getUpcomingGames(query.offset, query.size),
        discounted: ({ query }) =>
          games.getDiscountedGames(query.offset, query.size),
        monthly: ({ query }) => games.getMonthlyGames(query.offset, query.size),
        search: ({ query }) =>
          games.searchGames(query.q, query.offset, query.size),
        getById: ({ params }) => games.getGameById(params.id),
      })
    }),
)
