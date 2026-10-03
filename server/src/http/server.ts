import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Layer } from 'effect'
import { HttpRouter, HttpServerResponse, HttpStaticServer } from 'effect/http'
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
// probe, and the built SPA. `@effect/platform-node` is imported by subpath: its
// package root re-exports a Redis module that needs the optional `redis` peer.

const dirname = path.dirname(fileURLToPath(import.meta.url))
const clientBuildPath = path.resolve(dirname, '../../../client/build')

// Service graph for the games API handlers.
const GamesLive = GamesServiceLive.pipe(Layer.provide(SonyClientLive))
const ServicesLive = Layer.mergeAll(
  GamesLive,
  AccountServiceLive.pipe(Layer.provide([SonyAccountClientLive, GamesLive])),
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

// Hashed bundles live under /assets; an unknown file there is a 404, never
// index.html. The root layer serves index.html, favicon.png, and SPA deep links.
// Deep links get index.html only for an extensionless path whose Accept header
// includes text/html. `no-cache` keeps index.html from pointing at deleted
// bundles after a deploy. A missing build directory yields 404 for every path.
export const staticRoutes = (root: string) =>
  Layer.mergeAll(
    HttpStaticServer.layer({
      root: path.join(root, 'assets'),
      prefix: '/assets',
    }),
    HttpStaticServer.layer({ root, spa: true, cacheControl: 'no-cache' }),
  )

const AllRoutes = Layer.mergeAll(
  ApiRoutes,
  HealthRoute,
  staticRoutes(clientBuildPath),
)

// PORT is read here at the composition root (the imperative shell). Default 3000.
const port = Number.parseInt(process.env['PORT'] ?? '3000', 10) || 3000

export const ServerLive = HttpRouter.serve(AllRoutes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
)

export const runServer = (): void => {
  Layer.launch(ServerLive).pipe(NodeRuntime.runMain)
}
