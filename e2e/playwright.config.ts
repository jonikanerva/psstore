// The browser journeys of `mise run test:e2e` (STACK.md §11 and §14).
//
// Two deterministic test servers run the release build of
// `crates/server/examples/e2e_server.rs`: the real router, middleware, and
// client build over fake services with synthetic data. `mise run test:e2e`
// builds the server and the client first. Each run starts its own servers,
// so the journeys always test this build.
//
// Each server binds a free port that the operating system chooses
// (`--port 0`), so parallel runs on one machine do not collide (#178). The
// server prints its bound address. `webServer.wait` reads the port from that
// line and stores the named capture group as an environment variable of the
// runner. The workers start after the servers and inherit the variables;
// the `baseURL` fixture of `tests/journey.ts` reads them.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_VARIABLE, type TestServer } from './tests/servers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'target/release/examples/e2e_server')
const WEB_BUILD = path.join(ROOT, 'web/build')

// The capture group name in upper case is the environment variable name.
// The line end after the digits stops a match on a partly received port.
const testServer = (name: TestServer) => ({
  name,
  command: `"${SERVER}" --port 0 --web-build "${WEB_BUILD}" --scenario ${name}`,
  wait: {
    stdout: new RegExp(
      `e2e_server listening on http://127\\.0\\.0\\.1:(?<${PORT_VARIABLE[name].toLowerCase()}>[0-9]+)\\r?\\n`,
    ),
  },
  timeout: 30_000,
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
})

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  forbidOnly: true,
  // A failure is investigated, never retried away (DOCTRINE.md P6).
  retries: 0,
  fullyParallel: true,
  reporter: 'list',
  use: {
    // The client formats dates in the viewer's zone. A fixed zone and
    // locale make every run see the same page.
    locale: 'en-GB',
    timezoneId: 'Europe/Helsinki',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [testServer('healthy'), testServer('outage')],
})
