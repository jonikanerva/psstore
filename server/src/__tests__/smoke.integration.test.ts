import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  SONY_GRAPHQL_URL,
  SONY_LOCALE,
  SONY_RETRY_COUNT,
  SONY_TIMEOUT_MS,
} from '../config/env.js'
import {
  mapConceptsToGames,
  mapUpcomingConceptsToGames,
} from '../domain/listing.js'
import { fetchWithRetry } from '../lib/http.js'
import { buildStrategies, type SonyFeature } from '../sony/queryStrategies.js'
import {
  SonyClient,
  SonyClientLive,
  extractCategoryGrid,
} from '../sony/sonyClient.js'

// LIVE Sony smoke suite — the standing guard against a list that Sony drift
// empties without an error (UPCOMING/DISCOUNTED). Gated by SMOKE=1 so it never
// runs in `pnpm test` / `pnpm test-all` (network/uptime coupling -> flaky
// build); run it explicitly with `pnpm test:live`. It decodes REAL live responses through the
// production boundary (`extractCategoryGrid`) and maps via the production
// mappers (`listing.ts`), so a live Sony drift that drops/empties a list reds
// this suite — which `test-all` cannot, since it only decodes committed fixtures
// and diffs the manifest against itself.
//
// Load fence: exactly one raw fetch per feature + one
// PDP fetch. NEVER drive GamesServiceLive (its enrichment fans out at
// concurrency:'unbounded' -> dozens-to-hundreds of real calls = a load test).

const SMOKE = process.env['SMOKE'] === '1'
const describeSmoke = SMOKE ? describe : describe.skip

const localeOverride = (locale: string): string =>
  locale.replace(
    /^([a-z]{2})-([a-z]{2})$/i,
    (_m: string, l: string, r: string) =>
      `${l.toLowerCase()}-${r.toUpperCase()}`,
  )

// One raw GET per feature, mirroring the production SonyClient request, so the
// suite can assert `extractCategoryGrid`'s `dropped` count (which the decoded
// `fetchConceptsByFeature` result hides).
const fetchRawGrid = async (feature: SonyFeature): Promise<unknown> => {
  const strategy = buildStrategies()[feature]
  const variables = strategy.buildVariables({ size: 60, offset: 0 })
  const query = new URLSearchParams({
    operationName: strategy.operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: strategy.persistedQueryHash },
    }),
  }).toString()
  const response = await fetchWithRetry(
    `${SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': strategy.operationName,
        'x-psn-store-locale-override': localeOverride(SONY_LOCALE),
      },
    },
    SONY_TIMEOUT_MS,
    SONY_RETRY_COUNT,
  )
  return response.json()
}

type Mapper = typeof mapConceptsToGames

// Assert NO SILENT DROPS, not non-empty. A legitimately empty day must not red
// the suite. `dropped === 0` + the conditional "concepts present => they map to
// >= 1 game" is the invariant.
const assertNoSilentDrops = (raw: unknown, map: Mapper): number => {
  const outcome = extractCategoryGrid(raw)
  expect(outcome.kind).toBe('ok')
  if (outcome.kind !== 'ok') return 0
  expect(outcome.dropped).toBe(0)
  if (outcome.concepts.length > 0) {
    expect(map(outcome.concepts).length).toBeGreaterThan(0)
  }
  return outcome.concepts.length
}

describeSmoke(
  'Sony live smoke (SMOKE=1) — null-tolerance regression guard',
  () => {
    it('NEW decodes with no drops and maps to renderable games', async () => {
      const raw = await fetchRawGrid('new')
      const count = assertNoSilentDrops(raw, mapConceptsToGames)
      // NEW is the default view and near-certainly populated; soft-assert > 0.
      expect(count).toBeGreaterThan(0)
      globalThis.console.log(`[test:live] NEW concepts=${String(count)}`)
    }, 20_000)

    it('UPCOMING decodes with no drops (may be empty on a quiet day)', async () => {
      const raw = await fetchRawGrid('upcoming')
      const count = assertNoSilentDrops(raw, mapUpcomingConceptsToGames)
      globalThis.console.log(`[test:live] UPCOMING concepts=${String(count)}`)
    }, 20_000)

    it('DISCOUNTED decodes with no drops (may be empty on a quiet day)', async () => {
      const raw = await fetchRawGrid('discounted')
      const count = assertNoSilentDrops(raw, mapConceptsToGames)
      globalThis.console.log(`[test:live] DISCOUNTED concepts=${String(count)}`)
    }, 20_000)

    it('PDP: fetchProductDetail resolves for one SKU from the NEW result', async () => {
      const raw = await fetchRawGrid('new')
      const outcome = extractCategoryGrid(raw)
      expect(outcome.kind).toBe('ok')
      if (outcome.kind !== 'ok') return
      const games = mapConceptsToGames(outcome.concepts)
      const sku = games[0]?.id
      expect(sku).toBeTruthy()
      if (!sku) return

      const detail = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) => client.fetchProductDetail(sku)),
          Effect.provide(SonyClientLive),
        ),
      )
      expect(detail).toBeDefined()
      expect(typeof detail.description).toBe('string')
      globalThis.console.log(
        `[test:live] PDP sku=${sku} genres=${String(detail.genres.length)} descLen=${String(detail.description.length)}`,
      )
    }, 20_000)
  },
)
