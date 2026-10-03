import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  SONY_GRAPHQL_URL,
  SONY_LOCALE,
  SONY_RETRY_COUNT,
  SONY_TIMEOUT_MS,
} from '../config/env.js'
import {
  isPs5Game,
  mapConceptsToGames,
  mapUpcomingConceptsToGames,
} from '../domain/listing.js'
import { fetchWithRetry } from '../lib/http.js'
import { productDetailToGame } from '../sony/mapper.js'
import { buildStrategies, type SonyFeature } from '../sony/queryStrategies.js'
import {
  SonyClient,
  SonyClientLive,
  extractCategoryGrid,
  localeOverride,
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
// Load fence: exactly one raw fetch per feature + one PDP fetch + one search
// page per term + two product-id lookups (detail and price for one search-only
// PS5 id, detail for one PS4-only id). NEVER drive GamesServiceLive (its enrichment fans out at
// concurrency:'unbounded' -> dozens-to-hundreds of real calls = a load test).

const SMOKE = process.env['SMOKE'] === '1'
const describeSmoke = SMOKE ? describe : describe.skip

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

    it('MONTHLY: the PS Plus monthly list decodes to at least one PS5 game', async () => {
      const entries = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) => client.fetchPlusMonthly()),
          Effect.provide(SonyClientLive),
        ),
      )
      expect(entries.length).toBeGreaterThanOrEqual(1)
      globalThis.console.log(
        `[test:live] MONTHLY entries=${String(entries.length)}`,
      )
    }, 20_000)

    it.each(['elden', 'god of war'])(
      'SEARCH %s: the page decodes with no drops and keeps PS5 games',
      async (term) => {
        const page = await Effect.runPromise(
          SonyClient.pipe(
            Effect.flatMap((client) => client.fetchSearchPage(term, 0, 50)),
            Effect.provide(SonyClientLive),
          ),
        )
        expect(page.rawCount).toBeGreaterThan(0)
        expect(page.candidates.length).toBeGreaterThan(0)
        globalThis.console.log(
          `[test:live] SEARCH term=${term} raw=${String(page.rawCount)} candidates=${String(page.candidates.length)} isLast=${String(page.isLast)}`,
        )
      },
      20_000,
    )

    it('SEARCH bloodborne: a PS4-only title narrows to zero candidates', async () => {
      const page = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) =>
            client.fetchSearchPage('bloodborne', 0, 50),
          ),
          Effect.provide(SonyClientLive),
        ),
      )
      expect(page.rawCount).toBeGreaterThan(0)
      expect(page.candidates).toHaveLength(0)
      globalThis.console.log(
        `[test:live] SEARCH term=bloodborne raw=${String(page.rawCount)} candidates=0`,
      )
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

    it('PRICE: fetchProductPrice resolves the Plus offer for a known SKU', async () => {
      const sku = 'EP2640-PPSA29380_00-0000000000000000'
      const price = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) => client.fetchProductPrice(sku)),
          Effect.provide(SonyClientLive),
        ),
      )
      globalThis.console.log(
        `[test:live] PRICE sku=${sku} price=${JSON.stringify(price)}`,
      )
      expect(price.plusOffer).not.toBeUndefined()
      expect(price.standard).not.toBeUndefined()
    }, 20_000)

    it('CONCEPT: a concept id resolves to the product Sony sells for it', async () => {
      const productId = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) => client.fetchConceptProductId('10000368')),
          Effect.provide(SonyClientLive),
        ),
      )
      globalThis.console.log(
        `[test:live] CONCEPT 10000368 -> ${String(productId)}`,
      )
      expect(productId).toBe('EP9000-PPSA01341_00-DEMONSSOULS00000')
    }, 20_000)

    it('PRODUCT-ID: a search-only cross-generation id resolves to a PS5 game with a name and a cover', async () => {
      const id = 'EP0002-PPSA02410_00-DESTINYTHEGAME02'
      const [detail, price] = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) =>
            Effect.all([
              client.fetchProductDetail(id),
              client.fetchProductPrice(id),
            ]),
          ),
          Effect.provide(SonyClientLive),
        ),
      )
      expect(
        isPs5Game(detail.platforms, detail.storeDisplayClassification),
      ).toBe(true)
      const game = productDetailToGame(id, detail, price.standard)
      expect(game.name).not.toBe('')
      expect(game.url).not.toBe('')
      globalThis.console.log(
        `[test:live] PRODUCT-ID sku=${id} name=${game.name} platforms=${JSON.stringify(detail.platforms)} price=${game.price}`,
      )
    }, 20_000)

    it('PRODUCT-ID: a PS4-only id is not a PS5 game', async () => {
      const id = 'EP9000-CUSA00207_00-BLOODBORNE0000EU'
      const detail = await Effect.runPromise(
        SonyClient.pipe(
          Effect.flatMap((client) => client.fetchProductDetail(id)),
          Effect.provide(SonyClientLive),
        ),
      )
      expect(
        isPs5Game(detail.platforms, detail.storeDisplayClassification),
      ).toBe(false)
      globalThis.console.log(
        `[test:live] PRODUCT-ID sku=${id} platforms=${JSON.stringify(detail.platforms)}`,
      )
    }, 20_000)
  },
)
