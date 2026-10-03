import { Context, Effect, Layer, Logger, Redacted } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder, OpenApi } from 'effect/http-api'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { gamesApi } from '../api/gamesApi.js'
import {
  gamesGroupLive,
  NpssoAuthLive,
  sessionGroupLive,
} from '../api/gamesHandlers.js'
import {
  SessionRejected,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import { AccountServiceLive } from '../services/accountService.js'
import { GamesServiceLive } from '../services/gamesService.js'
import type { PurchasedEntry } from '../sony/purchasedSchema.js'
import {
  SonyAccountClient,
  SonyClient,
  type SonyAccountClientApi,
} from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

// A fake SonyClient: NEW returns one valid product SKU; product detail returns a
// past release date so the released gate keeps it. No network, no real env.
const productId = 'EP0001-PPSA00001_00-ALPHA00000000000'
const concept: Concept = {
  id: '1',
  name: 'Alpha',
  media: [{ type: 'IMAGE', role: 'MASTER', url: 'https://img/alpha' }],
  price: {
    basePrice: '€29.95',
    discountedPrice: '€29.95',
    serviceBranding: ['NONE'],
  },
  products: [{ id: productId }],
}

const monthlyProductId = 'UP7742-PPSA29413_00-0632159817352246'

const FakeSony = Layer.succeed(SonyClient, {
  fetchConceptsByFeature: (feature) =>
    Effect.succeed(feature === 'new' ? [concept] : []),
  fetchPlusMonthly: () =>
    Effect.succeed([
      {
        productId: monthlyProductId,
        name: 'Wobbly Life',
        imageUrl: 'https://img/wobbly',
        releaseDate: '2025-09-18T17:00:00Z',
        genres: ['Adventure'],
      },
    ]),
  fetchSearchPage: () =>
    Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
  fetchProductPrice: () => Effect.succeed(null),
  fetchProductDetail: () =>
    Effect.succeed({
      releaseDate: '2024-01-01T00:00:00Z',
      genres: [],
      description: '',
    }),
})

// A synthetic NPSSO and access token: no real credential appears in the tests.
const NPSSO = 'synthetic-npsso-0123456789abcdefghijklmnop'
const ACCESS_TOKEN = 'synthetic-access-token-qrstuvwxyz'

const libraryEntry: PurchasedEntry = {
  productId: 'EP9000-PPSA00009_00-LIBRARY000000000',
  conceptId: '10000001',
  name: 'Library Game',
  imageUrl: 'https://img/library',
}

interface AccountFake {
  readonly exchange: ReturnType<typeof vi.fn>
  readonly library: ReturnType<typeof vi.fn>
  readonly logs: string[]
}

// One app per account scenario. The fake counts Sony calls; the captured log
// lines let a test prove that no credential reaches the logger.
const accountApp = (
  overrides: Partial<SonyAccountClientApi> = {},
): {
  handler: (req: Request) => Promise<Response>
  dispose: () => Promise<void>
  fake: AccountFake
} => {
  const logs: string[] = []
  const exchange = vi.fn()
  const library = vi.fn()
  const sony: SonyAccountClientApi = {
    exchangeNpsso: (npsso) => {
      exchange(Redacted.value(npsso))
      return Effect.succeed(Redacted.make(ACCESS_TOKEN))
    },
    fetchPurchasedGames: (token) => {
      library(Redacted.value(token))
      return Effect.succeed([libraryEntry])
    },
    ...overrides,
  }
  const capture = Logger.make((options) => {
    logs.push(JSON.stringify([options.message, String(options.cause)]))
  })
  const App = HttpApiBuilder.layer(gamesApi).pipe(
    Layer.provide([gamesGroupLive, sessionGroupLive]),
    Layer.provide(NpssoAuthLive),
    Layer.provide(
      Layer.mergeAll(
        Services,
        AccountServiceLive.pipe(
          Layer.provide(Layer.succeed(SonyAccountClient, sony)),
        ),
      ),
    ),
    Layer.provide(Logger.layer([capture])),
    Layer.provide(HttpServer.layerServices),
  )
  const web = HttpRouter.toWebHandler(App)
  return {
    handler: (req) => web.handler(req, Context.empty()),
    dispose: web.dispose,
    fake: { exchange, library, logs },
  }
}

const Services = Layer.mergeAll(GamesServiceLive.pipe(Layer.provide(FakeSony)))

const AppLive = HttpApiBuilder.layer(gamesApi).pipe(
  Layer.provide([gamesGroupLive, sessionGroupLive]),
  Layer.provide(NpssoAuthLive),
  Layer.provide(
    Layer.mergeAll(
      Services,
      AccountServiceLive.pipe(
        Layer.provide(
          Layer.succeed(SonyAccountClient, {
            exchangeNpsso: () => Effect.succeed(Redacted.make(ACCESS_TOKEN)),
            fetchPurchasedGames: () => Effect.succeed([libraryEntry]),
          }),
        ),
      ),
    ),
  ),
  Layer.provide(HttpServer.layerServices),
)

const { handler, dispose } = HttpRouter.toWebHandler(AppLive)

// Fail-only apps for the 502/503 mapping tests. Each gets its OWN
// toWebHandler + dispose, kept SEPARATE from the success `handler` above: the
// 30s conceptsCache pins failures, so reusing/toggling a shared handler would
// poison it across tests and risk a false pass.
const failHandler = (
  error: UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited,
): {
  handler: (req: Request) => Promise<Response>
  dispose: () => Promise<void>
} => {
  const FailSony = Layer.succeed(SonyClient, {
    fetchConceptsByFeature: () => Effect.fail(error),
    fetchPlusMonthly: () =>
      error._tag === 'UpstreamQueryRotated'
        ? Effect.succeed([])
        : Effect.fail(error),
    fetchSearchPage: () =>
      Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
    fetchProductPrice: () => Effect.succeed(null),
    fetchProductDetail: () => Effect.fail(error),
  })
  const FailApp = HttpApiBuilder.layer(gamesApi).pipe(
    Layer.provide([gamesGroupLive, sessionGroupLive]),
    Layer.provide(NpssoAuthLive),
    Layer.provide(
      Layer.mergeAll(
        GamesServiceLive.pipe(Layer.provide(FailSony)),
        AccountServiceLive.pipe(
          Layer.provide(
            Layer.succeed(SonyAccountClient, {
              exchangeNpsso: () =>
                error._tag === 'UpstreamQueryRotated'
                  ? Effect.succeed(Redacted.make(ACCESS_TOKEN))
                  : Effect.fail(error),
              fetchPurchasedGames: () => Effect.fail(error),
            }),
          ),
        ),
      ),
    ),
    Layer.provide(HttpServer.layerServices),
  )
  return HttpRouter.toWebHandler(FailApp)
}

const unavailableApp = failHandler(
  new UpstreamUnavailable({ message: 'sony down' }),
)
const rotatedApp = failHandler(
  new UpstreamQueryRotated({
    message: 'rotated',
    operationName: 'categoryGridRetrieve',
  }),
)
const rateLimitedApp = failHandler(
  new UpstreamRateLimited({ message: 'rate limited', retryAfterSeconds: 3 }),
)

afterAll(async () => {
  await dispose()
  await unavailableApp.dispose()
  await rotatedApp.dispose()
  await rateLimitedApp.dispose()
})

describe('games HTTP API', () => {
  it('serves the NEW list as typed JSON', async () => {
    const response = await handler(
      new Request('http://localhost/api/games/new'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      games: { id: string }[]
      totalCount: number
    }
    expect(body.totalCount).toBe(1)
    expect(body.games[0]?.id).toBe(productId)
  })

  it('maps a missing game id to 404', async () => {
    const response = await handler(
      new Request(
        'http://localhost/api/games/EP0001-PPSA09999_00-MISSING000000000',
      ),
    )
    expect(response.status).toBe(404)
  })

  it('serves the MONTHLY list as typed JSON', async () => {
    const response = await handler(
      new Request('http://localhost/api/games/monthly'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      games: { id: string; price: string; plusOffer: unknown }[]
      totalCount: number
    }
    expect(body.totalCount).toBe(1)
    expect(body.games[0]).toMatchObject({
      id: monthlyProductId,
      price: '',
      plusOffer: null,
    })
  })

  it('resolves a monthly-only game on the product detail route', async () => {
    const response = await handler(
      new Request(`http://localhost/api/games/${monthlyProductId}`),
    )
    expect(response.status).toBe(200)
  })

  it('serves the product detail as typed JSON', async () => {
    const response = await handler(
      new Request(`http://localhost/api/games/${productId}`),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; idKind: string }
    expect(body.id).toBe(productId)
    expect(body.idKind).toBe('product')
  })

  it('rejects an out-of-range page size at the boundary with 400', async () => {
    const response = await handler(
      new Request('http://localhost/api/games/new?size=500'),
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('')
  })

  it('rejects a whitespace-only game id with an empty 400', async () => {
    const response = await handler(
      new Request('http://localhost/api/games/%20'),
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('')
  })

  it('rejects a negative offset and a non-numeric size with 400', async () => {
    const negative = await handler(
      new Request('http://localhost/api/games/new?offset=-1'),
    )
    const nonNumeric = await handler(
      new Request('http://localhost/api/games/new?size=abc'),
    )
    expect(negative.status).toBe(400)
    expect(nonNumeric.status).toBe(400)
    expect(await nonNumeric.text()).toBe('')
  })
})

describe('games OpenAPI document', () => {
  it('declares the 400 response without a body or error schema', () => {
    const spec = OpenApi.fromApi(gamesApi)
    const paths = [
      '/api/games/new',
      '/api/games/upcoming',
      '/api/games/discounted',
      '/api/games/monthly',
      '/api/games/{id}',
    ]
    for (const path of paths) {
      const bad = spec.paths[path]?.get?.responses['400']
      expect(bad, path).toBeDefined()
      expect(bad).not.toHaveProperty('content')
    }
    expect(
      Object.keys(spec.components.schemas).filter((name) =>
        name.includes('ValidationError'),
      ),
    ).toEqual([])
  })
})

describe('games HTTP API — honest upstream failure', () => {
  // Upcoming/discounted must not swallow a Sony outage into 200 + []; the typed
  // error maps to its HTTP status (gamesApi.addError): UpstreamUnavailable → 502,
  // UpstreamRateLimited → 503.
  it('maps an upcoming-tab upstream outage to 502', async () => {
    const response = await unavailableApp.handler(
      new Request('http://localhost/api/games/upcoming'),
    )
    expect(response.status).toBe(502)
  })

  it('maps a monthly-tab upstream outage to 502', async () => {
    const response = await unavailableApp.handler(
      new Request('http://localhost/api/games/monthly'),
    )
    expect(response.status).toBe(502)
  })

  it('maps a monthly-tab rate-limit to 503', async () => {
    const response = await rateLimitedApp.handler(
      new Request('http://localhost/api/games/monthly'),
    )
    expect(response.status).toBe(503)
  })

  it('maps a discounted-tab upstream outage to 502', async () => {
    const response = await unavailableApp.handler(
      new Request('http://localhost/api/games/discounted'),
    )
    expect(response.status).toBe(502)
  })

  it('maps an upcoming-tab rate-limit to 503', async () => {
    const response = await rateLimitedApp.handler(
      new Request('http://localhost/api/games/upcoming'),
    )
    expect(response.status).toBe(503)
  })

  it('maps a discounted-tab rate-limit to 503', async () => {
    const response = await rateLimitedApp.handler(
      new Request('http://localhost/api/games/discounted'),
    )
    expect(response.status).toBe(503)
  })

  it('maps a persisted-query rotation to 502', async () => {
    const response = await rotatedApp.handler(
      new Request('http://localhost/api/games/discounted'),
    )
    expect(response.status).toBe(502)
  })

  it('maps a NEW-tab outage to 502 and a rate-limit to 503', async () => {
    const unavailable = await unavailableApp.handler(
      new Request('http://localhost/api/games/new'),
    )
    const limited = await rateLimitedApp.handler(
      new Request('http://localhost/api/games/new'),
    )
    expect(unavailable.status).toBe(502)
    expect(limited.status).toBe(503)
  })

  it('maps a product-detail upstream failure to its upstream status', async () => {
    const id = 'EP0001-PPSA09999_00-MISSING000000000'
    const unavailable = await unavailableApp.handler(
      new Request(`http://localhost/api/games/${id}`),
    )
    const limited = await rateLimitedApp.handler(
      new Request(`http://localhost/api/games/${id}`),
    )
    const rotated = await rotatedApp.handler(
      new Request(`http://localhost/api/games/${id}`),
    )
    expect(unavailable.status).toBe(502)
    expect(limited.status).toBe(503)
    expect(rotated.status).toBe(502)
  })

  it('carries the typed error tag in the failure body', async () => {
    const response = await rateLimitedApp.handler(
      new Request('http://localhost/api/games/new'),
    )
    const body = (await response.json()) as {
      _tag: string
      retryAfterSeconds?: number
    }
    expect(body._tag).toBe('UpstreamRateLimited')
    expect(body.retryAfterSeconds).toBe(3)
  })
})

const signIn = (
  app: { handler: (req: Request) => Promise<Response> },
  body: string,
  contentType = 'application/json',
): Promise<Response> =>
  app.handler(
    new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
  )

const purchased = (
  app: { handler: (req: Request) => Promise<Response> },
  cookie?: string,
): Promise<Response> =>
  app.handler(
    new Request('http://localhost/api/games/purchased', {
      headers: cookie === undefined ? {} : { cookie },
    }),
  )

// Splits a Set-Cookie line into its name=value pair and its attributes, so the
// assertions do not depend on the order the serializer picks.
const parseSetCookie = (
  line: string,
): { pair: string; attributes: string[] } => {
  const [pair = '', ...attributes] = line.split('; ')
  return { pair, attributes: attributes.sort() }
}

const COOKIE_ATTRIBUTES = ['HttpOnly', 'Path=/api', 'SameSite=Strict', 'Secure']

describe('sign-in cookie API', () => {
  it('sets the exact cookie and answers an empty 204', async () => {
    const app = accountApp()
    const response = await signIn(app, JSON.stringify({ npsso: NPSSO }))
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    const lines = response.headers.getSetCookie()
    expect(lines).toHaveLength(1)
    const cookie = parseSetCookie(lines[0] ?? '')
    expect(cookie.pair).toBe(`npsso=${NPSSO}`)
    expect(cookie.attributes).toEqual(
      [...COOKIE_ATTRIBUTES, 'Max-Age=2592000'].sort(),
    )
    expect(app.fake.exchange).toHaveBeenCalledTimes(1)
    expect(app.fake.library).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('answers 401 without a cookie when Sony rejects the NPSSO', async () => {
    const app = accountApp({
      exchangeNpsso: () => Effect.fail(new SessionRejected({ message: 'no' })),
    })
    const response = await signIn(app, JSON.stringify({ npsso: NPSSO }))
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual([])
    await app.dispose()
  })

  it('answers 502 or 503 without a cookie when Sony is down', async () => {
    const down = accountApp({
      exchangeNpsso: () =>
        Effect.fail(new UpstreamUnavailable({ message: 'x' })),
    })
    const limited = accountApp({
      exchangeNpsso: () =>
        Effect.fail(new UpstreamRateLimited({ message: 'x' })),
    })
    const first = await signIn(down, JSON.stringify({ npsso: NPSSO }))
    const second = await signIn(limited, JSON.stringify({ npsso: NPSSO }))
    expect(first.status).toBe(502)
    expect(second.status).toBe(503)
    expect(first.headers.getSetCookie()).toEqual([])
    expect(second.headers.getSetCookie()).toEqual([])
    await down.dispose()
    await limited.dispose()
  })

  it('rejects a malformed payload with 400 before any Sony call', async () => {
    const app = accountApp()
    const bodies = [
      JSON.stringify({}),
      JSON.stringify({ npsso: 'short' }),
      JSON.stringify({ npsso: 'a'.repeat(513) }),
      JSON.stringify({ npsso: `${'a'.repeat(20)}; Path=/` }),
      JSON.stringify({ npsso: 42 }),
      'not json',
    ]
    for (const body of bodies) {
      const response = await signIn(app, body)
      expect(response.status, body).toBe(400)
      expect(response.headers.getSetCookie()).toEqual([])
    }
    expect(app.fake.exchange).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('rejects a non-JSON content type', async () => {
    const app = accountApp()
    const response = await signIn(
      app,
      JSON.stringify({ npsso: NPSSO }),
      'text/plain',
    )
    expect(response.status).toBe(415)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(app.fake.exchange).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('sends no CORS headers', async () => {
    const app = accountApp()
    const response = await signIn(app, JSON.stringify({ npsso: NPSSO }))
    const names = [...response.headers.keys()]
    expect(names.filter((name) => name.startsWith('access-control'))).toEqual(
      [],
    )
    await app.dispose()
  })

  it('expires the cookie on sign-out with the same attributes', async () => {
    const app = accountApp()
    const response = await app.handler(
      new Request('http://localhost/api/session', { method: 'DELETE' }),
    )
    expect(response.status).toBe(204)
    const lines = response.headers.getSetCookie()
    expect(lines).toHaveLength(1)
    const cookie = parseSetCookie(lines[0] ?? '')
    expect(cookie.pair).toBe('npsso=')
    expect(cookie.attributes).toContain('Max-Age=0')
    for (const attribute of COOKIE_ATTRIBUTES) {
      expect(cookie.attributes).toContain(attribute)
    }
    expect(app.fake.exchange).not.toHaveBeenCalled()
    await app.dispose()
  })
})

describe('purchased games API', () => {
  it('answers 401 without a Sony call when the cookie is missing', async () => {
    const app = accountApp()
    const response = await purchased(app)
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(app.fake.exchange).not.toHaveBeenCalled()
    expect(app.fake.library).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('answers 401 without a Sony call when the cookie is empty', async () => {
    const app = accountApp()
    const response = await purchased(app, 'npsso=')
    expect(response.status).toBe(401)
    expect(app.fake.exchange).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('serves the library at /purchased, not as a game id', async () => {
    const app = accountApp()
    const response = await purchased(app, `npsso=${NPSSO}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      games: { id: string; idKind: string; price: string }[]
      totalCount: number
      nextOffset: number | null
    }
    expect(body.totalCount).toBe(1)
    expect(body.nextOffset).toBeNull()
    expect(body.games[0]).toMatchObject({
      id: '10000001',
      idKind: 'concept',
      price: '',
    })
    expect(app.fake.exchange).toHaveBeenCalledWith(NPSSO)
    expect(app.fake.library).toHaveBeenCalledWith(ACCESS_TOKEN)
    expect(response.headers.getSetCookie()).toEqual([])
    await app.dispose()
  })

  it('still routes a real game id to the product detail', async () => {
    const response = await handler(
      new Request(`http://localhost/api/games/${productId}`),
    )
    expect(response.status).toBe(200)
  })

  it('exchanges the NPSSO on every request (no cache)', async () => {
    const app = accountApp()
    await purchased(app, `npsso=${NPSSO}`)
    await purchased(app, `npsso=${NPSSO}`)
    expect(app.fake.exchange).toHaveBeenCalledTimes(2)
    expect(app.fake.library).toHaveBeenCalledTimes(2)
    await app.dispose()
  })

  it('answers 401 and expires the cookie when Sony rejects the NPSSO', async () => {
    const app = accountApp({
      exchangeNpsso: () => Effect.fail(new SessionRejected({ message: 'no' })),
    })
    const response = await purchased(app, `npsso=${NPSSO}`)
    expect(response.status).toBe(401)
    const lines = response.headers.getSetCookie()
    expect(lines).toHaveLength(1)
    const cookie = parseSetCookie(lines[0] ?? '')
    expect(cookie.pair).toBe('npsso=')
    expect(cookie.attributes).toContain('Max-Age=0')
    await app.dispose()
  })

  it('keeps the cookie on an outage, a rate limit and a rotated hash', async () => {
    const cases: [Partial<SonyAccountClientApi>, number][] = [
      [
        {
          fetchPurchasedGames: () =>
            Effect.fail(new UpstreamUnavailable({ message: 'x' })),
        },
        502,
      ],
      [
        {
          exchangeNpsso: () =>
            Effect.fail(new UpstreamRateLimited({ message: 'x' })),
        },
        503,
      ],
      [
        {
          fetchPurchasedGames: () =>
            Effect.fail(
              new UpstreamQueryRotated({ message: 'x', operationName: 'op' }),
            ),
        },
        502,
      ],
    ]
    for (const [overrides, status] of cases) {
      const app = accountApp(overrides)
      const response = await purchased(app, `npsso=${NPSSO}`)
      expect(response.status).toBe(status)
      expect(response.headers.getSetCookie()).toEqual([])
      await app.dispose()
    }
  })

  it('never logs the NPSSO or the access token', async () => {
    const app = accountApp({
      fetchPurchasedGames: () =>
        Effect.fail(new UpstreamUnavailable({ message: 'x' })),
    })
    await purchased(app, `npsso=${NPSSO}`)
    await signIn(app, JSON.stringify({ npsso: NPSSO }))
    const rejected = accountApp({
      exchangeNpsso: () => Effect.fail(new SessionRejected({ message: 'no' })),
    })
    await purchased(rejected, `npsso=${NPSSO}`)
    const lines = [...app.fake.logs, ...rejected.fake.logs]
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toContain(NPSSO)
      expect(line).not.toContain(ACCESS_TOKEN)
      expect(line.toLowerCase()).not.toContain('location')
    }
    await app.dispose()
    await rejected.dispose()
  })

  it('documents the sign-in and purchased routes', () => {
    const spec = OpenApi.fromApi(gamesApi)
    expect(spec.paths['/api/games/purchased']?.get).toBeDefined()
    expect(spec.paths['/api/session']?.post).toBeDefined()
    expect(spec.paths['/api/session']?.delete).toBeDefined()
  })
})
