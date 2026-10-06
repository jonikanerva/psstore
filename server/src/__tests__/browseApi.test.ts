import { Context, Effect, Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { afterAll, describe, expect, it } from 'vitest'
import { gamesApi } from '../api/gamesApi.js'
import {
  gamesGroupLive,
  NpssoAuthLive,
  sessionGroupLive,
} from '../api/gamesHandlers.js'
import { UpstreamRateLimited, UpstreamUnavailable } from '../errors/errors.js'
import { AccountService } from '../services/accountService.js'
import { CriticScoreServiceDisabled } from '../services/criticScoreService.js'
import { GamesServiceLive } from '../services/gamesService.js'
import type { BrowseRequest } from '../sony/queryStrategies.js'
import { SonyClient } from '../sony/sonyClient.js'

const gameId = 'EP0001-PPSA00001_00-BROWSEGAME000001'

type Failure = UpstreamUnavailable | UpstreamRateLimited

const makeApp = (failure: Failure | null, calls: BrowseRequest[] = []) => {
  const fail = <A>(ok: A) =>
    failure === null ? Effect.succeed(ok) : Effect.fail(failure)
  const FakeSony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: () => Effect.succeed([]),
    fetchPlusMonthly: () => Effect.succeed([]),
    fetchSearchPage: () =>
      Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
    fetchProductPrice: () =>
      Effect.succeed({ plusOffer: null, standard: null }),
    fetchProductDetail: () =>
      Effect.succeed({
        releaseDate: '2024-01-01T00:00:00Z',
        media: [],
        genres: [],
        description: '',
        storeDisplayClassification: 'FULL_GAME',
        platforms: ['PS5'],
      }),
    fetchBrowsePage: (request) => {
      calls.push(request)
      return fail({
        concepts: [
          { id: '1', name: 'Browse Game', products: [{ id: gameId }] },
        ],
        isLast: true,
      })
    },
    fetchGenres: () =>
      fail([
        { key: 'ACTION', name: 'Action' },
        { key: 'MUSIC/RHYTHM', name: 'Music/Rhythm' },
      ]),
  })
  const App = HttpApiBuilder.layer(gamesApi).pipe(
    Layer.provide([gamesGroupLive, sessionGroupLive]),
    Layer.provide(NpssoAuthLive),
    Layer.provide(CriticScoreServiceDisabled),
    Layer.provide(
      Layer.mergeAll(
        GamesServiceLive.pipe(Layer.provide(FakeSony)),
        Layer.succeed(AccountService, {
          verifyNpsso: () => Effect.void,
          getPurchasedGames: () =>
            Effect.succeed({ games: [], totalCount: 0, nextOffset: null }),
          getWishlistGames: () =>
            Effect.succeed({ games: [], totalCount: 0, nextOffset: null }),
        }),
      ),
    ),
    Layer.provide(HttpServer.layerServices),
  )
  return HttpRouter.toWebHandler(App)
}

const calls: BrowseRequest[] = []
const okApp = makeApp(null, calls)
const unavailableApp = makeApp(new UpstreamUnavailable({ message: 'down' }))
const rateLimitedApp = makeApp(new UpstreamRateLimited({ message: 'slow' }))

const get = (app: typeof okApp, path: string): Promise<Response> =>
  app.handler(new Request(`http://localhost${path}`), Context.empty())

afterAll(async () => {
  await okApp.dispose()
  await unavailableApp.dispose()
  await rateLimitedApp.dispose()
})

describe('GET /api/games/genres', () => {
  it('serves the genre list and does not fall into the game id route', async () => {
    const response = await get(okApp, '/api/games/genres')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      genres: [
        { key: 'ACTION', name: 'Action' },
        { key: 'MUSIC/RHYTHM', name: 'Music/Rhythm' },
      ],
    })
  })

  it.each([
    [unavailableApp, 502],
    [rateLimitedApp, 503],
  ])('maps an upstream failure to its status', async (app, status) => {
    expect((await get(app, '/api/games/genres')).status).toBe(status)
  })
})

describe('GET /api/games/browse', () => {
  it('serves a page for a genre key with a slash', async () => {
    calls.length = 0
    const response = await get(
      okApp,
      `/api/games/browse?genre=${encodeURIComponent('MUSIC/RHYTHM')}&order=most-downloaded&offset=60&size=60`,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      games: { id: string; name: string }[]
      nextOffset: number | null
    }
    expect(body.games.map((game) => game.id)).toEqual([gameId])
    expect(body.nextOffset).toBeNull()
    expect(calls).toEqual([
      { genre: 'MUSIC/RHYTHM', order: 'most-downloaded', offset: 60, size: 60 },
    ])
  })

  it('defaults the page window', async () => {
    calls.length = 0
    const response = await get(
      okApp,
      '/api/games/browse?genre=ACTION&order=best-selling',
    )
    expect(response.status).toBe(200)
    expect(calls).toEqual([
      { genre: 'ACTION', order: 'best-selling', offset: 0, size: 60 },
    ])
  })

  it.each([
    ['a missing genre', '/api/games/browse?order=newest'],
    ['a missing order', '/api/games/browse?genre=ACTION'],
    ['an unknown order', '/api/games/browse?genre=ACTION&order=price'],
    ['a Sony sort name', '/api/games/browse?genre=ACTION&order=sales30'],
    ['a lower-case genre', '/api/games/browse?genre=action&order=newest'],
    [
      'a genre with a space',
      '/api/games/browse?genre=ROLE%20PLAYING&order=newest',
    ],
    [
      'a genre of 65 characters',
      `/api/games/browse?genre=${'A'.repeat(65)}&order=newest`,
    ],
    [
      'a size above 120',
      '/api/games/browse?genre=ACTION&order=newest&size=121',
    ],
    [
      'a negative offset',
      '/api/games/browse?genre=ACTION&order=newest&offset=-1',
    ],
  ])('rejects %s with 400', async (_label, path) => {
    calls.length = 0
    expect((await get(okApp, path)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it.each([
    [unavailableApp, 502],
    [rateLimitedApp, 503],
  ])('maps an upstream failure to its status', async (app, status) => {
    expect(
      (await get(app, '/api/games/browse?genre=ACTION&order=newest')).status,
    ).toBe(status)
  })
})
