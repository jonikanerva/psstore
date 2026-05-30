import { Etag, HttpLayerRouter, HttpPlatform } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { gamesApi } from '../api/gamesApi.js'
import { gamesGroupLive } from '../api/gamesHandlers.js'
import { GamesServiceLive } from '../services/gamesService.js'
import { SonyClient } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'
import { EnvLive } from '../config/env.js'

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

const Services = GamesServiceLive.pipe(
  Layer.provide(FakeSony),
  Layer.provide(EnvLive),
)

const PlatformLive = Layer.mergeAll(
  HttpPlatform.layer.pipe(Layer.provide(NodeContext.layer)),
  Etag.layer,
  NodeContext.layer,
)

const AppLive = HttpLayerRouter.addHttpApi(gamesApi).pipe(
  Layer.provide(gamesGroupLive),
  Layer.provide(Services),
  Layer.provide(PlatformLive),
)

const { handler, dispose } = HttpLayerRouter.toWebHandler(AppLive)

afterAll(async () => {
  await dispose()
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

  it('rejects an out-of-range page size at the boundary', async () => {
    const response = await handler(
      new Request('http://localhost/api/games/new?size=500'),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
  })
})
