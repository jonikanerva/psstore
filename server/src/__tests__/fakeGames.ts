import { Effect, Layer } from 'effect'
import { GameNotFound } from '../errors/errors.js'
import { GamesService, type GamesServiceApi } from '../services/gamesService.js'

const emptyPage = Effect.succeed({ games: [], totalCount: 0, nextOffset: null })

// A GamesService with no games: every list is empty and every id is unknown.
export const fakeGames = (
  overrides: Partial<GamesServiceApi> = {},
): GamesServiceApi => ({
  getNewGames: () => emptyPage,
  getUpcomingGames: () => emptyPage,
  getDiscountedGames: () => emptyPage,
  getMonthlyGames: () => emptyPage,
  searchGames: () => emptyPage,
  getGameById: (id) => Effect.fail(new GameNotFound({ id })),
  getGenres: () => Effect.succeed({ genres: [] }),
  getBrowseGames: () => emptyPage,
  ...overrides,
})

export const fakeGamesLayer = (
  overrides: Partial<GamesServiceApi> = {},
): Layer.Layer<GamesService> =>
  Layer.succeed(GamesService, fakeGames(overrides))
