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
import { AccountService } from '../services/accountService.js'
import { CriticScoreService } from '../services/criticScoreService.js'
import { fakeGamesLayer } from './fakeGames.js'

const baseGame = {
  id: 'EP0001-PPSA00001_00-ALPHA00000000000',
  name: 'Synthetic Quest',
  date: '2023-11-14T00:00:00Z',
  url: 'https://img/alpha',
  price: '€29,95',
  originalPrice: '€29,95',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind: 'product' as const,
}

const makeApp = (score: number | null) => {
  const App = HttpApiBuilder.layer(gamesApi).pipe(
    Layer.provide([gamesGroupLive, sessionGroupLive]),
    Layer.provide(NpssoAuthLive),
    Layer.provide(
      Layer.mergeAll(
        fakeGamesLayer({ getGameById: () => Effect.succeed(baseGame) }),
        Layer.succeed(CriticScoreService, {
          scoreFor: () => Effect.succeed(score),
        }),
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

const scored = makeApp(84)
const unscored = makeApp(null)

afterAll(async () => {
  await scored.dispose()
  await unscored.dispose()
})

const get = (app: ReturnType<typeof makeApp>) =>
  app.handler(
    new Request(`http://localhost/api/games/${baseGame.id}`),
    Context.empty(),
  )

describe('game page critic score', () => {
  it('adds the score to the game page payload', async () => {
    const response = await get(scored)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...baseGame, criticScore: 84 })
  })

  it('leaves the key out when there is no score', async () => {
    const response = await get(unscored)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(baseGame)
  })
})
