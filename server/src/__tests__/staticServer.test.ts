import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Context, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { staticRoutes } from '../http/server.js'

const browserAccept =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

const makeApp = (root: string) => {
  const Routes = Layer.mergeAll(
    HttpRouter.add('GET', '/healthz', HttpServerResponse.json({ ok: true })),
    HttpRouter.add('GET', '/api/ping', HttpServerResponse.json({ pong: true })),
    staticRoutes(root),
  ).pipe(Layer.provide(NodeHttpServer.layerHttpServices))
  const web = HttpRouter.toWebHandler(Routes, { disableLogger: true })
  return {
    get: (url: string, accept?: string) =>
      web.handler(
        new Request(
          `http://localhost${url}`,
          accept === undefined ? {} : { headers: { accept } },
        ),
        Context.empty(),
      ),
    dispose: web.dispose,
  }
}

describe('staticRoutes', () => {
  let dir = ''
  let app: ReturnType<typeof makeApp>
  let missing: ReturnType<typeof makeApp>

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'psstore-static-'))
    await mkdir(path.join(dir, 'build', 'assets'), { recursive: true })
    await writeFile(path.join(dir, 'package.json'), '{"secret":true}')
    await writeFile(
      path.join(dir, 'build', 'index.html'),
      '<!doctype html><title>spa</title>',
    )
    await writeFile(path.join(dir, 'build', 'favicon.png'), 'png')
    await writeFile(
      path.join(dir, 'build', 'assets', 'a-1.js'),
      'console.log(1)',
    )
    app = makeApp(path.join(dir, 'build'))
    missing = makeApp(path.join(dir, 'does-not-exist'))
  })

  afterAll(async () => {
    await app.dispose()
    await missing.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('serves a hashed bundle with a JavaScript content type', async () => {
    const res = await app.get('/assets/a-1.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
  })

  it('returns 404 for a missing asset and for the assets directory', async () => {
    expect((await app.get('/assets/nope.js')).status).toBe(404)
    expect((await app.get('/assets/')).status).toBe(404)
  })

  it('serves the favicon and 404s a missing image', async () => {
    const res = await app.get('/favicon.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect((await app.get('/nope.png')).status).toBe(404)
  })

  it('serves index.html at the root with no-cache', async () => {
    const res = await app.get('/', browserAccept)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('serves index.html for a deep link only when Accept includes text/html', async () => {
    const page = await app.get('/g/123', browserAccept)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>spa</title>')
    expect((await app.get('/g/123', '*/*')).status).toBe(404)
  })

  it('rejects path traversal', async () => {
    for (const url of [
      '/%2e%2e/%2e%2e/package.json',
      '/assets/..%2f..%2findex.html',
      '/assets/..%2f..%2f..%2fpackage.json',
    ]) {
      const res = await app.get(url, browserAccept)
      expect(res.status, url).toBe(404)
      expect(await res.text(), url).not.toContain('secret')
    }
  })

  it('returns 404 for every path when the build directory is missing', async () => {
    expect((await missing.get('/', browserAccept)).status).toBe(404)
    expect((await missing.get('/assets/a-1.js')).status).toBe(404)
  })

  it('keeps the health and API routes ahead of the static fallback', async () => {
    const health = await app.get('/healthz', browserAccept)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    expect(await (await app.get('/api/ping', browserAccept)).json()).toEqual({
      pong: true,
    })
  })
})
