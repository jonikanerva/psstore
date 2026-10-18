// The test function of the deterministic journeys: the shared fixture of
// `support.ts` plus the base URL of a test server (`servers.ts`).
//
// The base URL is a fixture, not a value in `playwright.config.ts`, because
// the runner loads the configuration before the servers print their ports.
// A fixture reads the port when a test starts in a worker. A test file selects the outage server with
// `test.use({ testServer: 'outage' })`.
import { test as base } from './support.js'
import { serverUrl, type TestServer } from './servers.js'

export { cardIds, expect, expectNoAxeViolations } from './support.js'

export const test = base.extend<{ testServer: TestServer }>({
  testServer: ['healthy', { option: true }],
  baseURL: async ({ testServer }, use) => {
    await use(serverUrl(testServer))
  },
})
