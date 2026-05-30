import {
  FileSystem,
  HttpLayerRouter,
  HttpServerResponse,
} from '@effect/platform'
import { NodeContext, NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gamesApi } from '../api/gamesApi.js'
import { gamesGroupLive } from '../api/gamesHandlers.js'
import { EnvLive } from '../config/env.js'
import { GamesServiceLive } from '../services/gamesService.js'
import { SonyClientLive } from '../sony/sonyClient.js'

// The HTTP composition root and the third (and last) module permitted to import
// `@effect/platform`. It mounts the typed games API, a health probe, and — in
// production — the built SPA with a deep-link fallback to index.html.

const dirname = path.dirname(fileURLToPath(import.meta.url))
const clientBuildPath = path.resolve(dirname, '../../../client/build')
const indexHtmlPath = path.join(clientBuildPath, 'index.html')

// Service graph for the games API handlers.
const ServicesLive = GamesServiceLive.pipe(
  Layer.provide(SonyClientLive),
  Layer.provide(EnvLive),
)

// Mount the typed REST API (prefix /api/games is declared on the group).
const ApiRoutes = HttpLayerRouter.addHttpApi(gamesApi).pipe(
  Layer.provide(gamesGroupLive),
  Layer.provide(ServicesLive),
)

const HealthRoute = HttpLayerRouter.use((router) =>
  router.add('GET', '/healthz', HttpServerResponse.json({ ok: true })),
)

// SPA deep-link fallback: any unmatched GET serves the built index.html so a
// client-side route (e.g. /g/:id) reloads correctly. Missing build (dev) → 404.
const SpaFallbackRoute = HttpLayerRouter.use((router) =>
  router.add(
    'GET',
    '/*',
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const exists = yield* fs.exists(indexHtmlPath)
      if (!exists) {
        return HttpServerResponse.empty({ status: 404 })
      }
      const html = yield* fs.readFileString(indexHtmlPath)
      return HttpServerResponse.html(html)
    }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 404 }))),
  ),
)

const AllRoutes = Layer.mergeAll(ApiRoutes, HealthRoute, SpaFallbackRoute)

// PORT is read here at the composition root (the imperative shell). The default
// matches the previous server.
const port = Number.parseInt(process.env['PORT'] ?? '3000', 10) || 3000

export const ServerLive = HttpLayerRouter.serve(AllRoutes).pipe(
  Layer.provide(NodeContext.layer),
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
)

export const runServer = (): void => {
  Layer.launch(ServerLive).pipe(NodeRuntime.runMain)
}
