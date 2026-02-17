# UI Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix five broken UI behaviors: square card images, missing genres on PDP, empty PDP description, empty discounted page, broken search.

**Architecture:** Fix CSS for square cards, switch search from broken HTML scraper to existing GraphQL path, point discounted strategy at Sony's deals category, expand product detail query to return genres + description for PDP enrichment.

**Tech Stack:** TypeScript, React, Vite, Express, Sony GraphQL persisted operations, Vitest.

---

### Task 1: Square card images and hide empty genres

**Files:**
- Modify: `client/src/components/GameCard.css:10-13`
- Modify: `client/src/components/GameCard.tsx:29-31`
- Modify: `client/src/__tests__/GameCard.test.tsx:50-58`

**Step 1: Update CSS to enforce square aspect ratio**

In `client/src/components/GameCard.css`, change the `.game-card--image-wrap` rule:

```css
.game-card--image-wrap {
  aspect-ratio: 1;
  background: var(--field-color);
  overflow: hidden;
}

.game-card--image-wrap .image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

Also remove the `min-height: 30px` from `.game-card--genres` since the genres row will be conditionally hidden.

**Step 2: Hide genre line when genres are empty**

In `client/src/components/GameCard.tsx`, replace the genres div:

```tsx
{game.genres.length > 0 && (
  <div className="game-card--genres" title={game.genres.join(', ')}>
    {game.genres.join(', ')}
  </div>
)}
```

**Step 3: Update GameCard test for empty genres**

In `client/src/__tests__/GameCard.test.tsx`, change the "shows Unknown genre when genres are empty" test:

```tsx
it('hides genre line when genres are empty', () => {
  render(
    <MemoryRouter>
      <GameCard game={{ ...game, genres: [] }} />
    </MemoryRouter>,
  )

  expect(screen.queryByText('Unknown genre')).not.toBeInTheDocument()
})
```

**Step 4: Run tests**

Run: `npm run test -w client`
Expected: PASS (all 12 tests).

**Step 5: Commit**

```bash
git add client/src/components/GameCard.css client/src/components/GameCard.tsx client/src/__tests__/GameCard.test.tsx
git commit -m "fix(ui): square card images and hide empty genres"
```

---

### Task 2: Switch search from HTML scraper to GraphQL

**Files:**
- Modify: `server/src/services/gamesService.ts:1-11` (imports), `:183-194` (findGameInSearchResults), `:247-270` (searchGames)
- Modify: `server/src/__tests__/gamesService.test.ts:3-11` (mocks), `:55-70` (mock impl), `:86-103` (search tests), `:148-167` (search tests)

**Step 1: Update gamesService imports**

In `server/src/services/gamesService.ts`, replace the `fetchSearchGames` import with `fetchSearchConcepts`:

```typescript
import {
  fetchConceptsByFeature,
  fetchSearchConcepts,
  fetchProductReleaseDate,
} from '../sony/sonyClient.js'
```

**Step 2: Rewrite `findGameInSearchResults` to use GraphQL**

Replace the existing function:

```typescript
const findGameInSearchResults = async (id: string): Promise<Game | null> => {
  const matches = await withCache(`search-id-${id}`, async () => {
    try {
      return await mapConceptsToGames(await fetchSearchConcepts(id, 60))
    } catch (error) {
      console.warn(`Search lookup failed for detail id ${id}`, error)
      return []
    }
  })

  return matches.find((game) => game.id === id) ?? null
}
```

**Step 3: Rewrite `searchGames` to use GraphQL**

Replace the existing function:

```typescript
export const searchGames = async (query: string): Promise<Game[]> => {
  const base = await baseGames()
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    const results = base.slice(0, MIN_ITEMS)
    rememberGamesForDetail(results)
    return results
  }

  const primary = await withCache(`search-${normalized}`, async () => {
    try {
      return await mapConceptsToGames(await fetchSearchConcepts(normalized, 60))
    } catch (error) {
      console.warn('Search query failed; using fallback results from base feed', error)
      return []
    }
  })

  const fallback = sortByDateDesc(base.filter((game) => game.name.toLowerCase().includes(normalized)))
  const results = primary.length > 0 ? primary : fallback
  rememberGamesForDetail(results)
  return results
}
```

**Step 4: Update test mocks**

In `server/src/__tests__/gamesService.test.ts`:

Replace `fetchSearchGames` mock declaration with `fetchSearchConcepts`:

```typescript
const fetchSearchConcepts = vi.fn()
```

Update the mock module:

```typescript
vi.mock('../sony/sonyClient.js', () => ({
  fetchConceptsByFeature,
  fetchProductReleaseDate,
  fetchSearchConcepts,
}))
```

Update `beforeEach` to reset `fetchSearchConcepts` instead of `fetchSearchGames`, and mock it to return concepts instead of games:

```typescript
fetchSearchConcepts.mockReset()

fetchSearchConcepts.mockResolvedValue([
  makeConcept('elden-ring', {
    products: [{ id: 'elden-ring-product', releaseDate: '2025-01-01T00:00:00Z' }],
  }),
])
```

**Step 5: Update search tests**

Update "search uses search client" test:

```typescript
it('search uses graphql search and returns non-empty result', async () => {
  const svc = await import('../services/gamesService.js')
  const result = await svc.searchGames('elden')

  expect(fetchSearchConcepts).toHaveBeenCalledWith('elden', 60)
  expect(result.length).toBeGreaterThan(0)
})
```

Update "resolves game detail for search result ids":

```typescript
it('resolves game detail for search result ids not present in base feed', async () => {
  const svc = await import('../services/gamesService.js')
  const results = await svc.searchGames('elden')

  expect(results[0]?.id).toBe('elden-ring-product')
  await expect(svc.getGameById('elden-ring-product')).resolves.toMatchObject({
    id: 'elden-ring-product',
    name: 'elden-ring',
  })
})
```

Update "returns strict empty result when fast and base-name search have no matches":

```typescript
it('returns strict empty result when graphql and base-name search have no matches', async () => {
  fetchSearchConcepts.mockResolvedValue([])

  const svc = await import('../services/gamesService.js')
  const result = await svc.searchGames('does-not-exist')

  expect(result).toHaveLength(0)
  expect(fetchSearchConcepts).toHaveBeenCalledWith('does-not-exist', 60)
})
```

Update "resolves search-only game detail without requiring warm search cache":

```typescript
it('resolves search-only game detail without requiring warm search cache', async () => {
  const svc = await import('../services/gamesService.js')

  await expect(svc.getGameById('elden-ring-product')).resolves.toMatchObject({
    id: 'elden-ring-product',
    name: 'elden-ring',
  })

  expect(fetchSearchConcepts).toHaveBeenCalledWith('elden-ring-product', 60)
})
```

**Step 6: Run tests**

Run: `npm run test -w server`
Expected: PASS (all 20 tests).

**Step 7: Commit**

```bash
git add server/src/services/gamesService.ts server/src/__tests__/gamesService.test.ts
git commit -m "fix(search): replace broken html scraper with graphql search"
```

---

### Task 3: Remove HTML scraper dead code

**Files:**
- Modify: `server/src/sony/sonyClient.ts:1-77` (remove scraper code)
- Modify: `server/src/__tests__/sonyClient.test.ts:19-38` (remove scraper test)

**Step 1: Remove scraper code from sonyClient.ts**

Delete lines 9-77 (all of): `SEARCH_TILE_RE`, `TELEMETRY_RE`, `IMAGE_RE`, `SearchTelemetry`, `decodeHtml`, `gameFromSearchTile`, `extractSearchGamesFromHtml`, and `fetchSearchGames`.

Also remove the `import type { Game } from '@psstore/shared'` on line 1, since only the scraper used it.

**Step 2: Remove scraper test from sonyClient.test.ts**

Delete the entire `describe('extractSearchGamesFromHtml', ...)` block and its import. The file should only keep the `extractReleaseDateFromProductResponse` test (which will be expanded in Task 5).

Update the import:

```typescript
import { extractReleaseDateFromProductResponse } from '../sony/sonyClient.js'
```

**Step 3: Run tests**

Run: `npm run test -w server`
Expected: PASS.

**Step 4: Run typecheck**

Run: `npm run typecheck -w server`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/src/sony/sonyClient.ts server/src/__tests__/sonyClient.test.ts
git commit -m "chore: remove dead html scraper code from sonyClient"
```

---

### Task 4: Use dedicated deals category for discounted page

**Files:**
- Modify: `server/src/config/env.ts` (add `SONY_DEALS_CATEGORY_ID`)
- Modify: `server/src/sony/queryStrategies.ts:46-49` (discounted strategy)
- Modify: `server/src/services/gamesService.ts:221-232` (getDiscountedGames)
- Modify: `server/src/__tests__/gamesService.test.ts:244-310` (discounted test)

**Step 1: Add deals category ID to env config**

In `server/src/config/env.ts`, add to the envSchema:

```typescript
SONY_DEALS_CATEGORY_ID: z.string().default('3f772501-f6f8-49b7-abac-874a88ca4897'),
```

**Step 2: Update discounted query strategy**

In `server/src/sony/queryStrategies.ts`, change the discounted strategy to use the deals category ID with no pricePromotion filter:

```typescript
discounted: strategy('discounted', 'discounted', (context) => ({
  ...baseVariables(context),
  id: env.SONY_DEALS_CATEGORY_ID,
  filterBy: ['targetPlatforms:PS5'],
})),
```

**Step 3: Simplify getDiscountedGames**

In `server/src/services/gamesService.ts`, replace `getDiscountedGames`:

```typescript
export const getDiscountedGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const primaryConcepts = await featureConcepts('discounted')
  const all = await mapConceptsToGames(primaryConcepts)
  const result = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('discounted', all.length, result.length)
  return result
}
```

This removes the `isConceptDiscounted` filter (everything from the deals category is discounted) and the `discountDate` guard (which was preventing items without enriched dates from appearing).

**Step 4: Update discounted test**

In `server/src/__tests__/gamesService.test.ts`, simplify the discounted test to verify that all items from the deals feed that are released show up, regardless of their concept-level price:

```typescript
it('discounted returns all released games from deals feed in descending order', async () => {
  fetchConceptsByFeature.mockImplementation(async (feature: string) => {
    if (feature === 'new') {
      return baseConcepts
    }
    if (feature !== 'discounted') {
      return []
    }

    return [
      makeConcept('deal-recent', {
        products: [{ id: 'd-r', releaseDate: '2026-02-01T00:00:00Z' }],
      }),
      makeConcept('deal-old', {
        products: [{ id: 'd-o', releaseDate: '2025-02-01T00:00:00Z' }],
      }),
      makeConcept('deal-future', {
        products: [{ id: 'd-f', releaseDate: '2099-01-01T00:00:00Z' }],
      }),
    ]
  })

  fetchProductReleaseDate.mockImplementation(async (productId: string) => {
    if (productId === 'd-r') return '2026-02-01T00:00:00Z'
    if (productId === 'd-o') return '2025-02-01T00:00:00Z'
    if (productId === 'd-f') return '2099-01-01T00:00:00Z'
    return '2025-01-01T00:00:00Z'
  })

  const svc = await import('../services/gamesService.js')
  const results = await svc.getDiscountedGames()

  expect(results.every((game) => Date.parse(game.date) <= Date.now())).toBe(true)
  expect(results.map((game) => game.name)).toEqual(['deal-recent', 'deal-old'])
})
```

**Step 5: Run tests**

Run: `npm run test -w server`
Expected: PASS.

**Step 6: Commit**

```bash
git add server/src/config/env.ts server/src/sony/queryStrategies.ts server/src/services/gamesService.ts server/src/__tests__/gamesService.test.ts
git commit -m "fix(discounted): use dedicated sony deals category"
```

---

### Task 5: PDP enrichment with genres and description

**Files:**
- Modify: `server/src/sony/types.ts:39-46` (expand ProductRetrieveResponse)
- Modify: `server/src/sony/sonyClient.ts` (expand fetchProductReleaseDate into fetchProductDetail)
- Modify: `server/src/services/gamesService.ts` (enrich getGameById with detail)
- Modify: `server/src/__tests__/sonyClient.test.ts` (update test)

**Step 1: Expand ProductRetrieveResponse type**

In `server/src/sony/types.ts`, replace the `ProductRetrieveResponse` interface:

```typescript
export interface ProductDetail {
  id?: string
  releaseDate?: string
  publisherName?: string
  genres?: string[]
  description?: string
  longDescription?: string
}

export interface ProductRetrieveResponse {
  data?: {
    productRetrieve?: ProductDetail
  }
}
```

**Step 2: Add extractProductDetail and fetchProductDetail to sonyClient**

In `server/src/sony/sonyClient.ts`, keep `extractReleaseDateFromProductResponse` for backward compat in tests, and add:

```typescript
export interface ProductDetailResult {
  releaseDate?: string
  genres: string[]
  description: string
}

export const extractProductDetail = (json: ProductRetrieveResponse): ProductDetailResult => {
  const product = json.data?.productRetrieve
  const releaseDate = typeof product?.releaseDate === 'string' && product.releaseDate.length > 0
    ? product.releaseDate
    : undefined
  const genres = product?.genres ?? []
  const description = product?.longDescription ?? product?.description ?? ''

  return { releaseDate, genres, description }
}

export const fetchProductDetail = async (productId: string): Promise<ProductDetailResult> => {
  const query = new URLSearchParams({
    operationName: productOperationName,
    variables: JSON.stringify({ productId }),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: productOperationHash },
    }),
  }).toString()

  const response = await fetchWithRetry(
    `${env.SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/json',
        'x-apollo-operation-name': productOperationName,
        'x-psn-store-locale-override': localeOverride,
      },
    },
    env.SONY_TIMEOUT_MS,
    env.SONY_RETRY_COUNT,
  )

  const json = (await response.json()) as ProductRetrieveResponse
  return extractProductDetail(json)
}
```

**Step 3: Update gamesService to enrich PDP with detail**

In `server/src/services/gamesService.ts`, import `fetchProductDetail` alongside `fetchProductReleaseDate`:

```typescript
import {
  fetchConceptsByFeature,
  fetchSearchConcepts,
  fetchProductReleaseDate,
  fetchProductDetail,
} from '../sony/sonyClient.js'
```

Add an enrichment helper before `getGameById`:

```typescript
const enrichGameWithDetail = async (game: Game): Promise<Game> => {
  try {
    const detail = await fetchProductDetail(game.id)
    return {
      ...game,
      date: detail.releaseDate ?? game.date,
      genres: detail.genres.length > 0 ? detail.genres : game.genres,
      description: detail.description || game.description,
    }
  } catch (error) {
    console.warn(`Product detail enrichment failed for ${game.id}`, error)
    return game
  }
}
```

Update `getGameById` to enrich the result before returning. Wrap each return path:

```typescript
export const getGameById = async (id: string): Promise<Game> => {
  const cached = cache.get<Game>(detailCacheKey(id))
  if (cached) {
    return gameSchema.parse(await enrichGameWithDetail(cached))
  }

  const games = await baseGames()
  const game = games.find((item) => item.id === id)

  if (game) {
    const enriched = await enrichGameWithDetail(game)
    cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
    return gameSchema.parse(enriched)
  }

  for (const feature of ['upcoming', 'discounted', 'plus'] as const) {
    const featureGame = await findGameInFeatureConcepts(feature, id)
    if (featureGame) {
      const enriched = await enrichGameWithDetail(featureGame)
      cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
      return gameSchema.parse(enriched)
    }
  }

  const searchGame = await findGameInSearchResults(id)
  if (searchGame) {
    const enriched = await enrichGameWithDetail(searchGame)
    cache.set(detailCacheKey(enriched.id), enriched, DETAIL_TTL_MS)
    return gameSchema.parse(enriched)
  }

  throw new HttpError(404, 'GAME_NOT_FOUND', 'Game not found')
}
```

**Step 4: Add extractProductDetail test**

In `server/src/__tests__/sonyClient.test.ts`, add:

```typescript
import { extractProductDetail, extractReleaseDateFromProductResponse } from '../sony/sonyClient.js'

describe('extractProductDetail', () => {
  it('extracts releaseDate, genres, and description', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'UP0102-PPSA02530_00-PRAGMATA00000000',
          releaseDate: '2026-04-23T21:00:00Z',
          genres: ['Action', 'Adventure'],
          longDescription: '<p>An amazing game</p>',
        },
      },
    })

    expect(result.releaseDate).toBe('2026-04-23T21:00:00Z')
    expect(result.genres).toEqual(['Action', 'Adventure'])
    expect(result.description).toBe('<p>An amazing game</p>')
  })

  it('returns empty defaults when fields are missing', () => {
    const result = extractProductDetail({
      data: { productRetrieve: { id: 'test' } },
    })

    expect(result.releaseDate).toBeUndefined()
    expect(result.genres).toEqual([])
    expect(result.description).toBe('')
  })
})
```

**Step 5: Run tests**

Run: `npm run test -w server`
Expected: PASS.

**Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

**Step 7: Commit**

```bash
git add server/src/sony/types.ts server/src/sony/sonyClient.ts server/src/services/gamesService.ts server/src/__tests__/sonyClient.test.ts
git commit -m "feat(pdp): enrich game detail with genres and description"
```

---

### Task 6: Final quality gate and integration verification

**Step 1: Run full lint**

Run: `npm run lint`
Expected: PASS.

**Step 2: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS.

**Step 3: Run full test suite**

Run: `npm run test`
Expected: PASS (all tests across all workspaces).

**Step 4: Run build**

Run: `npm run build`
Expected: PASS.

**Step 5: Commit any remaining fixes if needed**
