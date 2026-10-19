// The test servers that `playwright.config.ts` starts. Both run the release
// build of `crates/server/examples/e2e_server.rs` over synthetic data.
//
// Each server binds a free port that the operating system chooses, so
// parallel runs on one machine do not collide. Playwright reads the port
// from the output line of the server and puts it in an environment
// variable of the runner. The workers start after the servers, so they
// inherit the variables. The runner itself loads this module before the
// servers start, so call `serverUrl` only in a test or a fixture.

// `healthy`: every view has data. `outage`: every store lookup fails like
// an upstream outage (502 or 503).
export type TestServer = 'healthy' | 'outage'

// The environment variable of each server port. Playwright stores a named
// capture group of `webServer.wait` in upper case.
export const PORT_VARIABLE = {
  healthy: 'PSSTORE_E2E_HEALTHY_PORT',
  outage: 'PSSTORE_E2E_OUTAGE_PORT',
} as const satisfies Record<TestServer, string>

// The origin of a test server. It fails when the port is not known, so a
// test never navigates to a wrong address.
export const serverUrl = (server: TestServer): string => {
  const port = process.env[PORT_VARIABLE[server]]
  if (port === undefined || !/^[0-9]+$/.test(port)) {
    throw new Error(
      `${PORT_VARIABLE[server]} is not set: run the journeys with playwright.config.ts`,
    )
  }
  return `http://127.0.0.1:${port}`
}

// The only NPSSO that the test server accepts. It is synthetic and has 32
// characters, so it is no real NPSSO.
export const SYNTHETIC_NPSSO = 'e2e-synthetic-npsso-000000000000'

// The product id of synthetic game `n` (`product_id` in the test server).
export const productId = (n: number): string => {
  const digits = String(n).padStart(4, '0')
  return `EP9000-PPSA9${digits}_00-E2ESYNTHETIC${digits}`
}

// No synthetic game has number 9999, so its game page is a 404.
export const MISSING_GAME_ID = productId(9999)
