import { Context, Effect, Layer, Logger } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder, OpenApi } from 'effect/http-api'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { gamesApi } from '../api/gamesApi.js'
import {
  gamesGroupLive,
  NpssoAuthLive,
  sessionGroupLive,
} from '../api/gamesHandlers.js'
import {
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import { AccountService } from '../services/accountService.js'
import { GamesServiceLive } from '../services/gamesService.js'
import { productToConcept } from '../sony/mapper.js'
import { SonyClient, type SearchPage } from '../sony/sonyClient.js'

const gameId = 'EP0001-PPSA00001_00-SEARCHGAME000001'
const TERM = 'zq-secret-term'

const okPage: SearchPage = {
  candidates: [
    {
      kind: 'known',
      concept: productToConcept({ id: gameId, name: 'Search Game' }),
    },
  ],
  isLast: true,
  rawCount: 1,
}

type SearchFailure =
  UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited

const logLines: string[] = []
const captureLogger = Logger.make((options) => {
  logLines.push(Logger.formatJson.log(options))
})

const makeApp = (outcome: SearchPage | SearchFailure) => {
  const FakeSony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: () => Effect.succeed([]),
    fetchPlusMonthly: () => Effect.succeed([]),
    fetchProductPrice: () =>
      Effect.succeed({ plusOffer: null, standard: null }),
    fetchProductDetail: () =>
      Effect.succeed({
        releaseDate: '2024-01-01T00:00:00Z',
        media: [],
        genres: [],
        description: '',
      }),
    fetchSearchPage: () =>
      'candidates' in outcome ? Effect.succeed(outcome) : Effect.fail(outcome),
  })
  const App = HttpApiBuilder.layer(gamesApi).pipe(
    Layer.provide([gamesGroupLive, sessionGroupLive]),
    Layer.provide(NpssoAuthLive),
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
    Layer.provideMerge(Logger.layer([captureLogger])),
  )
  return HttpRouter.toWebHandler(App)
}

const okApp = makeApp(okPage)
const unavailableApp = makeApp(new UpstreamUnavailable({ message: 'down' }))
const rotatedApp = makeApp(
  new UpstreamQueryRotated({ message: 'rotated', operationName: 'x' }),
)
const rateLimitedApp = makeApp(new UpstreamRateLimited({ message: 'slow' }))

const get = (app: typeof okApp, path: string): Promise<Response> =>
  app.handler(new Request(`http://localhost${path}`), Context.empty())

beforeEach(() => {
  logLines.length = 0
})

afterAll(async () => {
  await okApp.dispose()
  await unavailableApp.dispose()
  await rotatedApp.dispose()
  await rateLimitedApp.dispose()
})

describe('GET /api/games/search', () => {
  it('serves a page result and does not fall into the game id route', async () => {
    const response = await get(okApp, '/api/games/search?q=search')

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      games: { id: string; date: string }[]
      nextOffset: number | null
    }
    expect(body.games.map((game) => game.id)).toEqual([gameId])
    expect(body.games[0]?.date).toBe('2024-01-01T00:00:00Z')
    expect(body.nextOffset).toBeNull()
  })

  it('accepts a term with special characters', async () => {
    const term = encodeURIComponent('a & b <c> "d"')

    expect((await get(okApp, `/api/games/search?q=${term}`)).status).toBe(200)
  })

  it('accepts the maximum size of 50 and exactly 100 characters', async () => {
    const hundred = 'a'.repeat(100)

    expect(
      (await get(okApp, `/api/games/search?q=${hundred}&size=50`)).status,
    ).toBe(200)
  })

  it.each([
    ['a missing term', '/api/games/search'],
    ['an empty term', '/api/games/search?q='],
    ['a whitespace-only term', '/api/games/search?q=%20%20'],
    ['a term of 101 characters', `/api/games/search?q=${'a'.repeat(101)}`],
    ['a size above 50', '/api/games/search?q=x&size=51'],
    ['a size of 0', '/api/games/search?q=x&size=0'],
    ['a negative offset', '/api/games/search?q=x&offset=-1'],
  ])('rejects %s with an empty 400', async (_label, path) => {
    const response = await get(okApp, path)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('')
  })

  it('counts the length after trimming', async () => {
    const padded = `%20${'a'.repeat(100)}%20`

    expect((await get(okApp, `/api/games/search?q=${padded}`)).status).toBe(200)
  })

  it('maps an upstream outage to 502', async () => {
    expect((await get(unavailableApp, '/api/games/search?q=x')).status).toBe(
      502,
    )
  })

  it('maps a persisted-query rotation to 502', async () => {
    expect((await get(rotatedApp, '/api/games/search?q=x')).status).toBe(502)
  })

  it('maps a rate limit to 503', async () => {
    expect((await get(rateLimitedApp, '/api/games/search?q=x')).status).toBe(
      503,
    )
  })

  it('never writes the term to a log line', async () => {
    await get(okApp, `/api/games/search?q=${TERM}`)
    await get(unavailableApp, `/api/games/search?q=${TERM}`)
    await get(rateLimitedApp, `/api/games/search?q=${TERM}`)

    expect(logLines.join('\n')).toContain('/api/games/search')
    expect(logLines.join('\n')).not.toContain(TERM)
    expect(logLines.join('\n')).not.toContain(encodeURIComponent(TERM))
  })

  it('declares the 400 response without a body in the OpenAPI document', () => {
    const bad =
      OpenApi.fromApi(gamesApi).paths['/api/games/search']?.get?.responses[
        '400'
      ]

    expect(bad).toBeDefined()
    expect(bad).not.toHaveProperty('content')
  })
})
