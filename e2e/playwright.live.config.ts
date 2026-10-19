// The live CSP check of `mise run test:e2e-live` (STACK.md §14 → Live
// checks). It is not part of `mise run verify`.
//
// The release server runs against live Sony, with no credentials: the IGDB
// variables are set empty, so the critic score is off. The browser loads
// Sony's real images and videos, and the shared fixture fails the run on any
// CSP violation. `mise run build` makes the server and the client first.
//
// `live/server.ts` starts the server on a free port and prints the address,
// so two live checks on one machine do not collide (#191). `webServer.wait`
// stores the port as the environment variable `PSSTORE_LIVE_PORT`;
// `live/csp.live.spec.ts` reads it in the worker and uses absolute URLs.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  testDir: './live',
  outputDir: './test-results/live',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Live Sony answers can take several seconds.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    ...devices['Desktop Chrome'],
    locale: 'en-GB',
    timezoneId: 'Europe/Helsinki',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    name: 'live',
    // The server reads the client build from `web/build` under its working
    // directory.
    command: `"${process.execPath}" e2e/live/server.ts ./target/release/psstore-server`,
    cwd: ROOT,
    // The capture group name in upper case is the environment variable name.
    // The line end after the digits stops a match on a partly received port.
    wait: {
      stdout:
        /live server listening on http:\/\/127\.0\.0\.1:(?<psstore_live_port>[0-9]+)\r?\n/,
    },
    env: {
      IGDB_CLIENT_ID: '',
      IGDB_CLIENT_SECRET: '',
      PSSTORE_LOG_FORMAT: 'text',
    },
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
})
