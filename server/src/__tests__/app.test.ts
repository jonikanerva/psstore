import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder, OpenApi } from 'effect/http-api'
import { afterAll, describe, expect, it } from 'vitest'
import { gamesApi } from '../api/gamesApi.js'
import { gamesGroupLive } from '../api/gamesHandlers.js'
import {
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import { GamesServiceLive } from '../services/gamesService.js'
import { SonyClient } from '../sony/sonyClient.js'
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

const FakeSony = Layer.succeed(SonyClient, {
  fetchConceptsByFeature: (feature) =>
    Effect.succeed(feature === 'new' ? [concept] : []),
  fetchProductDetail: () =>
    Effect.succeed({
      releaseDate: '2024-01-01T00:00:00Z',
      genres: [],
      description: '',
    }),
})

const Services = GamesServiceLive.pipe(Layer.provide(FakeSony))

const AppLive = HttpApiBuilder.layer(gamesApi).pipe(
  Layer.provide(gamesGroupLive),
  Layer.provide(Services),
  Layer.provide(HttpServer.layerServices),
)

const { handler, dispose } = HttpRouter.toWebHandler(AppLive)

// Fail-only apps for the 502/503 mapping tests (issue #78). Each gets its OWN
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
    fetchProductDetail: () => Effect.fail(error),
  })
  const FailApp = HttpApiBuilder.layer(gamesApi).pipe(
    Layer.provide(gamesGroupLive),
    Layer.provide(GamesServiceLive.pipe(Layer.provide(FailSony))),
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

describe('games HTTP API — honest upstream failure (issue #78)', () => {
  // Upcoming/discounted no longer swallow a Sony outage into 200 + []; the typed
  // error maps to its HTTP status (gamesApi.addError): UpstreamUnavailable → 502,
  // UpstreamRateLimited → 503.
  it('maps an upcoming-tab upstream outage to 502', async () => {
    const response = await unavailableApp.handler(
      new Request('http://localhost/api/games/upcoming'),
    )
    expect(response.status).toBe(502)
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
