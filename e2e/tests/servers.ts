// The test servers that `playwright.config.ts` starts. Both run the release
// build of `crates/server/examples/e2e_server.rs` over synthetic data.
export const HEALTHY_PORT = 47311
export const OUTAGE_PORT = 47312

// Every view has data.
export const HEALTHY_URL = `http://127.0.0.1:${String(HEALTHY_PORT)}`
// Every store lookup fails like an upstream outage (502 or 503).
export const OUTAGE_URL = `http://127.0.0.1:${String(OUTAGE_PORT)}`

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
