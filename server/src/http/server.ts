import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Effect, FileSystem, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gamesApi } from '../api/gamesApi.js'
import {
  gamesGroupLive,
  NpssoAuthLive,
  sessionGroupLive,
} from '../api/gamesHandlers.js'
import { AccountServiceLive } from '../services/accountService.js'
import { GamesServiceLive } from '../services/gamesService.js'
import { SonyAccountClientLive, SonyClientLive } from '../sony/sonyClient.js'

// The HTTP composition root and the third (and last) module permitted to import
// `effect/http` and `effect/http-api`. It mounts the typed games API, a health
// probe, and — in production — the built SPA with a deep-link fallback to
// index.html. `@effect/platform-node` is imported by subpath: its package root
// re-exports a Redis module that needs the optional `redis` peer.

const dirname = path.dirname(fileURLToPath(import.meta.url))
const clientBuildPath = path.resolve(dirname, '../../../client/build')
const indexHtmlPath = path.join(clientBuildPath, 'index.html')

// Service graph for the games API handlers.
const ServicesLive = Layer.mergeAll(
  GamesServiceLive.pipe(Layer.provide(SonyClientLive)),
  AccountServiceLive.pipe(Layer.provide(SonyAccountClientLive)),
)

// Mount the typed REST API (prefixes /api/games and /api/session are declared
// on the groups).
const ApiRoutes = HttpApiBuilder.layer(gamesApi).pipe(
  Layer.provide([gamesGroupLive, sessionGroupLive]),
  Layer.provide(NpssoAuthLive),
  Layer.provide(ServicesLive),
)

const HealthRoute = HttpRouter.add(
  'GET',
  '/healthz',
  HttpServerResponse.json({ ok: true }),
)

// SPA deep-link fallback: any unmatched GET serves the built index.html so a
// client-side route (e.g. /g/:id) reloads correctly. Missing build (dev) → 404.
const SpaFallbackRoute = HttpRouter.add(
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
  }).pipe(
    Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 404 })),
  ),
)

const AllRoutes = Layer.mergeAll(ApiRoutes, HealthRoute, SpaFallbackRoute)

// PORT is read here at the composition root (the imperative shell). Default 3000.
const port = Number.parseInt(process.env['PORT'] ?? '3000', 10) || 3000

export const ServerLive = HttpRouter.serve(AllRoutes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
)

export const runServer = (): void => {
  Layer.launch(ServerLive).pipe(NodeRuntime.runMain)
}
