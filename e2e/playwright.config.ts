// The browser journeys of `mise run test:e2e` (STACK.md §11 and §14).
//
// Two deterministic test servers run the release build of
// `crates/server/examples/e2e_server.rs`: the real router, middleware, and
// client build over fake services with synthetic data. `mise run test:e2e`
// builds the server and the client first. The servers use fixed ports and
// never reuse a running server, so the journeys always test this build.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HEALTHY_PORT,
  HEALTHY_URL,
  OUTAGE_PORT,
  OUTAGE_URL,
} from './tests/servers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'target/release/examples/e2e_server')
const WEB_BUILD = path.join(ROOT, 'web/build')

const testServer = (
  name: string,
  port: number,
  url: string,
  scenario: string,
) => ({
  name,
  command: `"${SERVER}" --port ${String(port)} --web-build "${WEB_BUILD}" --scenario ${scenario}`,
  url: `${url}/healthz`,
  reuseExistingServer: false,
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
    baseURL: HEALTHY_URL,
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
  webServer: [
    testServer('healthy', HEALTHY_PORT, HEALTHY_URL, 'healthy'),
    testServer('outage', OUTAGE_PORT, OUTAGE_URL, 'outage'),
  ],
})
