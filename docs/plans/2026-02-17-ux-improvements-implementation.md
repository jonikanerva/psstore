# UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove performance bottleneck (120 API calls → 1), redesign compact game cards, add discount display, remove genre filter, rename brand, simplify Plus tab, and add infinite scroll with server-side pagination.

**Architecture:** Server listing endpoints switch from returning `Game[]` to a paginated `PageResult` envelope. The `withProductReleaseDates` enrichment is removed from listings (kept on PDP only). Client `Games` component uses `IntersectionObserver` for infinite scroll. Two new schema fields (`originalPrice`, `discountText`) enable discount display on cards.

**Tech Stack:** TypeScript, Zod, Express, React, CSS, Vitest

---

### Task 1: Add `originalPrice` and `discountText` to shared schema + mapper

**Files:**
- Modify: `shared/src/schemas/game.ts`
- Modify: `server/src/sony/mapper.ts`
- Modify: `client/src/__tests__/GameCard.test.tsx` (update fixture)
- Modify: `server/src/__tests__/gamesService.test.ts` (update fixture)

**Step 1: Write the failing test — verify mapper outputs new fields**

Add to `server/src/__tests__/gamesService.test.ts` — update the `makeConcept` helper's default price to include `basePrice`/`discountedPrice`/`discountText`, and add a test:

```typescript
it('maps discount fields from concept price', async () => {
  fetchConceptsByFeature.mockImplementation(async (feature: string) => {
    if (feature !== 'new') return []
    return [
      makeConcept('full-price'),
      makeConcept('on-sale', {
        price: {
          basePrice: '€59,99',
          discountedPrice: '€39,99',
          discountText: '-33%',
          serviceBranding: ['NONE'],
          upsellServiceBranding: ['NONE'],
        },
      }),
    ]
  })

  const svc = await import('../services/gamesService.js')
  const games = await svc.getNewGames()

  const fullPrice = games.find((g) => g.name === 'full-price')
  expect(fullPrice?.originalPrice).toBe('')
  expect(fullPrice?.discountText).toBe('')

  const onSale = games.find((g) => g.name === 'on-sale')
  expect(onSale?.originalPrice).toBe('€59,99')
  expect(onSale?.discountText).toBe('-33%')
  expect(onSale?.price).toBe('€39,99')
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run`
Expected: FAIL — `originalPrice` property doesn't exist on Game type.

**Step 3: Add fields to shared schema**

In `shared/src/schemas/game.ts`, add two fields to `gameSchema`:

```typescript
export const gameSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  url: z.string(),
  price: z.string(),
  originalPrice: z.string(),
  discountText: z.string(),
  discountDate: z.string(),
  screenshots: z.array(z.string()),
  videos: z.array(z.string()),
  genres: z.array(z.string()),
  description: z.string(),
  studio: z.string(),
  preOrder: z.boolean()
})
```

**Step 4: Update mapper to populate new fields**

In `server/src/sony/mapper.ts`, update `conceptToGame` return object — add after the `price` line:

```typescript
originalPrice: discounted ? String(concept.price?.basePrice || '') : '',
discountText: discounted ? String(concept.price?.discountText || '') : '',
```

**Step 5: Update all test fixtures to include new fields**

In `client/src/__tests__/GameCard.test.tsx`, add to the `game` constant:

```typescript
originalPrice: '',
discountText: '',
```

In `client/src/__tests__/GameDetailsPage.test.tsx`, add the same two fields to any game fixtures.

In `client/src/__tests__/AppShell.test.tsx` — no game fixtures, no change needed.

**Step 6: Run tests to verify they pass**

Run: `npm run test -- --run`
Expected: ALL PASS

**Step 7: Run full quality gates**

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add shared/src/schemas/game.ts server/src/sony/mapper.ts client/src/__tests__/GameCard.test.tsx client/src/__tests__/GameDetailsPage.test.tsx server/src/__tests__/gamesService.test.ts
git commit -m "feat: add originalPrice and discountText to game schema and mapper"
```

---

### Task 2: Remove `withProductReleaseDates` from listing pipeline + simplify Plus

**Files:**
- Modify: `server/src/services/gamesService.ts`
- Modify: `server/src/__tests__/gamesService.test.ts`

**Step 1: Update tests — remove `fetchProductReleaseDate` expectations**

In `server/src/__tests__/gamesService.test.ts`:

1. The `fetchProductReleaseDate` mock can remain (it's still used by `fetchProductDetail` delegation) but listings should NOT call it. Add an assertion to the "returns non-empty sets" test:

```typescript
it('listing endpoints do not call fetchProductReleaseDate', async () => {
  const svc = await import('../services/gamesService.js')
  await svc.getNewGames()
  await svc.getUpcomingGames()
  await svc.getDiscountedGames()
  await svc.getPlusGames()
  expect(fetchProductReleaseDate).not.toHaveBeenCalled()
})
```

2. Update the "returns strict empty result" test — `plus.length` should now be `0` (not `toBeGreaterThan(0)`) since Plus no longer falls back to base games:

```typescript
expect(plus.length).toBe(0)
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- --run`
Expected: FAIL — `fetchProductReleaseDate` is still being called, and Plus still returns base fallback.

**Step 3: Remove enrichment from listing pipeline**

In `server/src/services/gamesService.ts`:

1. Change `mapConceptsToGames` to stop calling `withProductReleaseDates`:

```typescript
const mapConceptsToGames = (concepts: Concept[]): Game[] => {
  const mapped = concepts
    .map((concept) => conceptToGame(concept))
    .filter((game) => Boolean(game.id || game.name))

  return gamesSchema.parse(mapped)
}
```

Note: this is now synchronous — change all callers from `await mapConceptsToGames(...)` to just `mapConceptsToGames(...)`.

2. Simplify `getPlusGames` — remove `ensureNonEmpty`, remove `isConceptPlus` filtering:

```typescript
export const getPlusGames = async (): Promise<Game[]> => {
  const now = Date.now()
  const all = mapConceptsToGames(await featureConcepts('plus'))
  const result = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('plus', all.length, result.length)
  return result
}
```

3. Remove the now-unused code:
   - Delete `withProductReleaseDates` function (lines 53-110)
   - Delete `ensureNonEmpty` function (lines 128-138)
   - Delete `RELEASE_DATE_CONCURRENCY` constant
   - Delete `RELEASE_DATE_TTL_MS` constant
   - Remove `fetchProductReleaseDate` import (keep `fetchProductDetail`)
   - Remove `isConceptPlus` import
   - Remove `defaultDiscountDate` import
   - Remove `isConceptDiscounted` import (no longer needed in mapConceptsToGames)

4. Update `getNewGames`, `getUpcomingGames`, `getDiscountedGames` — remove `await` before `mapConceptsToGames` calls.

5. Update `baseGames` — remove `await` before `mapConceptsToGames`:

```typescript
const baseGames = async (): Promise<Game[]> =>
  withCache('games-new', async () => sortByDateDesc(mapConceptsToGames(await baseConcepts())))
```

6. Update `findGameInFeatureConcepts` — remove `await` before `mapConceptsToGames`:

```typescript
const games = mapConceptsToGames(matchingConcepts)
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- --run`
Expected: ALL PASS

**Step 5: Run full quality gates**

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add server/src/services/gamesService.ts server/src/__tests__/gamesService.test.ts
git commit -m "perf: remove withProductReleaseDates from listings, simplify Plus tab"
```

---

### Task 3: Compact GameCard redesign + remove genres from card

**Files:**
- Modify: `client/src/components/GameCard.tsx`
- Modify: `client/src/components/GameCard.css`
- Modify: `client/src/components/Games.css`
- Modify: `client/src/__tests__/GameCard.test.tsx`

**Step 1: Update test — remove genre assertion, add discount display test**

In `client/src/__tests__/GameCard.test.tsx`:

1. Update the "renders title, genres, and price" test — remove genre assertion, rename test:

```typescript
it('renders title, date, and price', () => {
  render(
    <MemoryRouter>
      <GameCard game={game} />
    </MemoryRouter>,
  )

  expect(screen.getByText('Test Game')).toBeInTheDocument()
  expect(screen.getByText('69,99 €')).toBeInTheDocument()
  expect(screen.getByText(/15 Jun 2025|Jun 15, 2025/)).toBeInTheDocument()
})
```

2. Remove the "hides genre line when genres are empty" test entirely.

3. Add discount display test:

```typescript
it('shows original price with strikethrough when discounted', () => {
  render(
    <MemoryRouter>
      <GameCard
        game={{
          ...game,
          price: '€39,99',
          originalPrice: '€59,99',
          discountText: '-33%',
        }}
      />
    </MemoryRouter>,
  )

  const original = screen.getByText('€59,99')
  expect(original.tagName).toBe('S')
  expect(screen.getByText('€39,99')).toBeInTheDocument()
})

it('shows single price when not discounted', () => {
  render(
    <MemoryRouter>
      <GameCard game={game} />
    </MemoryRouter>,
  )

  expect(screen.queryByRole('deletion')).not.toBeInTheDocument()
  expect(screen.getByText('69,99 €')).toBeInTheDocument()
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- --run`
Expected: FAIL — strikethrough element doesn't exist yet, date not shown in card.

**Step 3: Redesign GameCard component**

Replace `client/src/components/GameCard.tsx`:

```tsx
import { DateTime } from 'luxon'
import { Link } from 'react-router-dom'
import type { Game } from '@psstore/shared'
import Image from './Image'
import './GameCard.css'

interface GameCardProps {
  game: Game
}

const formatDate = (value: string): string => {
  const parsed = DateTime.fromISO(value)
  if (!parsed.isValid) {
    return 'Unknown'
  }

  return parsed.toLocaleString(DateTime.DATE_MED)
}

const GameCard = ({ game }: GameCardProps) => {
  const hasDiscount = Boolean(game.originalPrice) && game.originalPrice !== game.price

  return (
    <Link className="game-card" to={`/g/${game.id}`}>
      <div className="game-card--image-wrap">
        <Image url={game.url} name={game.name} />
      </div>
      <div className="game-card--body">
        <div className="game-card--name" title={game.name}>
          {game.name}
        </div>
        <div className="game-card--meta">
          <span className="game-card--date">{formatDate(game.date)}</span>
          <span className="game-card--price">
            {hasDiscount && (
              <s className="game-card--original-price">{game.originalPrice}</s>
            )}
            {game.price || '-'}
          </span>
        </div>
      </div>
    </Link>
  )
}

export default GameCard
```

**Step 4: Update GameCard CSS for compact layout**

Replace `client/src/components/GameCard.css`:

```css
.game-card {
  color: inherit;
  text-decoration: none;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface-color);
  overflow: hidden;
}

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

.game-card--body {
  padding: 8px;
}

.game-card--name {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-height: 36px;
}

.game-card--meta {
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px;
}

.game-card--date {
  font-size: 12px;
  color: var(--muted-text-color);
}

.game-card--price {
  font-weight: 700;
  font-size: 14px;
  text-align: right;
  white-space: nowrap;
}

.game-card--original-price {
  color: var(--muted-text-color);
  font-weight: 400;
  font-size: 12px;
  margin-right: 4px;
}

.game-card:focus-visible {
  outline: 2px solid var(--focus-color);
  outline-offset: 1px;
}
```

**Step 5: Update Games grid CSS for auto-fill**

In `client/src/components/Games.css`, replace the `.games--grid` rule and its media queries:

```css
.games--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 250px));
  gap: 10px;
}
```

Remove the two `@media` blocks for `.games--grid` (the `760px` and `1080px` breakpoints) — `auto-fill` handles responsiveness.

**Step 6: Run tests to verify they pass**

Run: `npm run test -- --run`
Expected: ALL PASS

**Step 7: Run full quality gates**

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add client/src/components/GameCard.tsx client/src/components/GameCard.css client/src/components/Games.css client/src/__tests__/GameCard.test.tsx
git commit -m "feat: compact game card redesign with discount display"
```

---

### Task 4: Remove genre filter + rename brand to "PS Store"

**Files:**
- Modify: `client/src/components/Games.tsx`
- Modify: `client/src/components/Games.css`
- Modify: `client/src/components/AppShell.tsx`
- Modify: `client/src/components/App.tsx`
- Modify: `client/src/__tests__/AppShell.test.tsx`
- Modify: `shared/src/utils/filters.ts`
- Modify: `shared/src/index.ts`

**Step 1: Update AppShell test**

In `client/src/__tests__/AppShell.test.tsx`, change `'PS5 Catalog'` to `'PS Store'`:

```typescript
expect(screen.getByText('PS Store')).toBeInTheDocument()
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- --run`
Expected: FAIL — still says "PS5 Catalog".

**Step 3: Rename brand**

In `client/src/components/AppShell.tsx`, change:

```tsx
<div className="app-shell--brand">PS Store</div>
```

**Step 4: Remove genre filter from Games component**

In `client/src/components/Games.tsx`:

1. Remove `filterGamesByGenre` import
2. Remove `filter` state (`useState<string>('')`)
3. Remove `showFilters` prop (and its default)
4. Remove `filteredGames` memo — use `games` directly
5. Remove the entire `genreList` const and `games--filter-navi` JSX block
6. Replace `filteredGames` references with `games`

Updated component:

```tsx
import type { Game as GameObject } from '@psstore/shared'
import { useEffect, useState } from 'react'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

interface GamesProps {
  label: string
  fetch: () => Promise<GameObject[]>
  emptyMessage?: string
}

const Games = ({ label, fetch, emptyMessage = 'No games found' }: GamesProps) => {
  const [games, setGames] = useState<GameObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch()
      .then((gamesResponse) => {
        if (!cancelled) {
          setGames(gamesResponse)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [fetch])

  if (error) {
    return <Error message="Failed to load games" />
  }

  if (loading) {
    return <Loading loading={loading} />
  }

  if (games.length === 0) {
    return <Error message={emptyMessage} />
  }

  return (
    <>
      <ScrollToTopOnMount />
      <div className="games--content">
        <div className="games--grid" data-label={label}>
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </div>
    </>
  )
}

export default Games
```

**Step 5: Remove `showFilters` prop from App.tsx**

In `client/src/components/App.tsx`, remove any `showFilters` prop from `<Games>` elements (if present). Currently none of the routes pass it explicitly so the default was used — no changes needed here.

**Step 6: Clean up filter CSS**

In `client/src/components/Games.css`, remove these rules entirely:
- `.games--selected`
- `.games--filter-navi`
- `.games--filter-name`
- `.games--filter-name:focus-visible`

**Step 7: Remove `filterGamesByGenre` from shared**

In `shared/src/utils/filters.ts`, delete the `filterGamesByGenre` function. Keep `sortByDateDesc`.

In `shared/src/index.ts`, no change needed (it re-exports all from `filters.ts` with `*`).

**Step 8: Run tests to verify they pass**

Run: `npm run test -- --run`
Expected: ALL PASS

**Step 9: Run full quality gates**

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`
Expected: ALL PASS. If lint/typecheck reports unused `filterGamesByGenre` imports anywhere, remove them.

**Step 10: Commit**

```bash
git add client/src/components/Games.tsx client/src/components/Games.css client/src/components/AppShell.tsx client/src/__tests__/AppShell.test.tsx shared/src/utils/filters.ts
git commit -m "feat: remove genre filter, rename brand to PS Store"
```

---

### Task 5: Server-side pagination

**Files:**
- Modify: `shared/src/schemas/game.ts` (add `PageResult` type)
- Modify: `server/src/validation/schemas.ts` (add pagination query schema)
- Modify: `server/src/services/gamesService.ts` (add pagination params)
- Modify: `server/src/api/gamesRoutes.ts` (parse query params, return envelope)
- Modify: `server/src/__tests__/gamesService.test.ts`
- Modify: `server/src/__tests__/validation.test.ts`

**Step 1: Write failing tests for pagination**

In `server/src/__tests__/validation.test.ts`, add:

```typescript
import { gameIdParamSchema, paginationQuerySchema } from '../validation/schemas.js'

describe('paginationQuerySchema', () => {
  it('uses defaults for empty query', () => {
    const result = paginationQuerySchema.parse({})
    expect(result).toEqual({ offset: 0, size: 60 })
  })

  it('parses string values', () => {
    const result = paginationQuerySchema.parse({ offset: '60', size: '30' })
    expect(result).toEqual({ offset: 60, size: 30 })
  })

  it('clamps size to max 120', () => {
    const result = paginationQuerySchema.parse({ size: '500' })
    expect(result.size).toBe(120)
  })

  it('rejects negative offset', () => {
    expect(paginationQuerySchema.safeParse({ offset: '-1' }).success).toBe(false)
  })
})
```

In `server/src/__tests__/gamesService.test.ts`, add:

```typescript
it('getNewGames respects offset and size', async () => {
  const concepts = Array.from({ length: 10 }, (_, i) =>
    makeConcept(`game-${i}`, {
      products: [{ id: `p-${i}`, releaseDate: `2025-0${Math.min(i + 1, 9)}-01T00:00:00Z` }],
    }),
  )

  fetchConceptsByFeature.mockImplementation(async (feature: string) =>
    feature === 'new' ? concepts : [],
  )

  const svc = await import('../services/gamesService.js')
  const page = await svc.getNewGames(0, 3)

  expect(page.games).toHaveLength(3)
  expect(page.totalCount).toBeGreaterThanOrEqual(3)
  expect(page.nextOffset).toBe(3)
})

it('getNewGames returns null nextOffset on last page', async () => {
  const svc = await import('../services/gamesService.js')
  const page = await svc.getNewGames(0, 200)

  expect(page.nextOffset).toBeNull()
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- --run`
Expected: FAIL — `paginationQuerySchema` doesn't exist, `getNewGames` doesn't accept args.

**Step 3: Add PageResult schema to shared**

In `shared/src/schemas/game.ts`, add after `gamesSchema`:

```typescript
export const pageResultSchema = z.object({
  games: z.array(gameSchema),
  totalCount: z.number(),
  nextOffset: z.number().nullable(),
})
```

In `shared/src/types/game.ts`, add:

```typescript
import type { gameSchema, errorPayloadSchema, pageResultSchema } from '../schemas/game.js'

export type PageResult = z.infer<typeof pageResultSchema>
```

**Step 4: Add pagination query schema**

In `server/src/validation/schemas.ts`:

```typescript
import { z } from 'zod'

export const gameIdParamSchema = z.object({
  id: z.string().trim().min(1),
})

export const paginationQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(120).default(60),
})
```

**Step 5: Update service functions to return PageResult**

In `server/src/services/gamesService.ts`, update each listing function to accept `offset` and `size` and return `PageResult`:

```typescript
import { gameSchema, gamesSchema, pageResultSchema, sortByDateDesc, type Game, type PageResult } from '@psstore/shared'
```

Add a helper at top of file:

```typescript
const paginate = (games: Game[], offset: number, size: number): PageResult => {
  const page = games.slice(offset, offset + size)
  const nextOffset = offset + size < games.length ? offset + size : null
  return { games: page, totalCount: games.length, nextOffset }
}
```

Update each listing function:

```typescript
export const getNewGames = async (offset = 0, size = 60): Promise<PageResult> => {
  const games = await baseGames()
  const now = Date.now()
  const filtered = sortByDateDesc(games.filter((game) => isReleased(game, now)))
  logFilterStats('new', games.length, filtered.length)
  return paginate(filtered, offset, size)
}

export const getUpcomingGames = async (offset = 0, size = 60): Promise<PageResult> => {
  const now = Date.now()
  const primary = mapConceptsToGames(await featureConcepts('upcoming'))
  const filtered = sortByDateAsc(primary.filter((game) => isUpcoming(game, now)))
  logFilterStats('upcoming', primary.length, filtered.length)
  return paginate(filtered, offset, size)
}

export const getDiscountedGames = async (offset = 0, size = 60): Promise<PageResult> => {
  const now = Date.now()
  const primaryConcepts = await featureConcepts('discounted')
  const all = mapConceptsToGames(primaryConcepts)
  const filtered = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('discounted', all.length, filtered.length)
  return paginate(filtered, offset, size)
}

export const getPlusGames = async (offset = 0, size = 60): Promise<PageResult> => {
  const now = Date.now()
  const all = mapConceptsToGames(await featureConcepts('plus'))
  const filtered = sortByDateDesc(all.filter((game) => isReleased(game, now)))
  logFilterStats('plus', all.length, filtered.length)
  return paginate(filtered, offset, size)
}
```

**Step 6: Update routes to parse pagination and return envelope**

In `server/src/api/gamesRoutes.ts`:

```typescript
import { Router } from 'express'
import {
  getDiscountedGames,
  getGameById,
  getNewGames,
  getPlusGames,
  getUpcomingGames,
} from '../services/gamesService.js'
import { gameIdParamSchema, paginationQuerySchema } from '../validation/schemas.js'

export const gamesRouter = Router()

gamesRouter.get('/new', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getNewGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/upcoming', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getUpcomingGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/discounted', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getDiscountedGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/plus', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getPlusGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/:id', async (request, response, next) => {
  try {
    const { id } = gameIdParamSchema.parse(request.params)
    response.json(await getGameById(id))
  } catch (error) {
    next(error)
  }
})
```

**Step 7: Update existing service tests**

The existing tests in `gamesService.test.ts` call `getNewGames()` etc. and expect arrays. They now return `PageResult`. Update all existing assertions:

- `await expect(svc.getNewGames()).resolves.not.toHaveLength(0)` → `expect((await svc.getNewGames()).games.length).toBeGreaterThan(0)`
- `const results = await svc.getNewGames()` → `const { games: results } = await svc.getNewGames()`
- `const upcoming = await svc.getUpcomingGames()` → `const { games: upcoming } = await svc.getUpcomingGames()`
- Same pattern for all `getDiscountedGames`, `getPlusGames` calls
- The "returns strict empty result" test: destructure `.games` from each call

**Step 8: Run tests to verify they pass**

Run: `npm run test -- --run`
Expected: ALL PASS

**Step 9: Run full quality gates**

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`
Expected: ALL PASS

**Step 10: Commit**

```bash
git add shared/src/schemas/game.ts shared/src/types/game.ts server/src/validation/schemas.ts server/src/services/gamesService.ts server/src/api/gamesRoutes.ts server/src/__tests__/gamesService.test.ts server/src/__tests__/validation.test.ts
git commit -m "feat: add server-side pagination with PageResult envelope"
```

---

### Task 6: Client infinite scroll

**Files:**
- Modify: `client/src/components/Games.tsx`
- Modify: `client/src/components/Games.css`
- Modify: `client/src/modules/psnStore.ts`
- Modify: `client/src/components/App.tsx`

**Step 1: Update client fetch functions for pagination**

In `client/src/modules/psnStore.ts`:

```typescript
import type { Game, PageResult } from '@psstore/shared'

const jsonHeaders = { Accept: 'application/json' }

const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: jsonHeaders })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export const fetchNewGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/new?offset=${offset}&size=${size}`)
export const fetchUpcomingGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/upcoming?offset=${offset}&size=${size}`)
export const fetchDiscountedGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/discounted?offset=${offset}&size=${size}`)
export const fetchPlusGames = async (offset: number, size: number): Promise<PageResult> =>
  getJson(`/api/games/plus?offset=${offset}&size=${size}`)
export const fetchGame = async (gameId: string): Promise<Game> =>
  getJson(`/api/games/${encodeURIComponent(gameId)}`)

export const metacriticLink = (name: string): string =>
  `https://www.metacritic.com/search/game/${encodeURI(
    name,
  )}/results?plats%5B72496%5D=1&search_type=advanced&sort=recent`

export type { Game, PageResult }
```

**Step 2: Update Games component for infinite scroll**

In `client/src/components/Games.tsx`:

```tsx
import type { Game as GameObject, PageResult } from '@psstore/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

const PAGE_SIZE = 60

interface GamesProps {
  label: string
  fetch: (offset: number, size: number) => Promise<PageResult>
  emptyMessage?: string
}

const Games = ({ label, fetch, emptyMessage = 'No games found' }: GamesProps) => {
  const [games, setGames] = useState<GameObject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      try {
        const result = await fetch(offset, PAGE_SIZE)
        setGames((prev) => (append ? [...prev, ...result.games] : result.games))
        setNextOffset(result.nextOffset)
      } catch {
        if (!append) {
          setError(true)
        }
      } finally {
        if (append) {
          setLoadingMore(false)
        } else {
          setLoading(false)
        }
      }
    },
    [fetch],
  )

  useEffect(() => {
    setGames([])
    setNextOffset(null)
    setError(false)
    loadPage(0, false)
  }, [loadPage])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextOffset !== null && !loadingMore) {
          loadPage(nextOffset, true)
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [nextOffset, loadingMore, loadPage])

  if (error) {
    return <Error message="Failed to load games" />
  }

  if (loading) {
    return <Loading loading={loading} />
  }

  if (games.length === 0) {
    return <Error message={emptyMessage} />
  }

  return (
    <>
      <ScrollToTopOnMount />
      <div className="games--content">
        <div className="games--grid" data-label={label}>
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
        <div ref={sentinelRef} className="games--sentinel">
          {loadingMore && <Loading loading />}
        </div>
      </div>
    </>
  )
}

export default Games
```

**Step 3: Add sentinel styling**

In `client/src/components/Games.css`, add:

```css
.games--sentinel {
  display: flex;
  justify-content: center;
  padding: 16px 0;
  min-height: 1px;
}
```

**Step 4: Update App.tsx — fetch prop signatures already match**

The `fetch` prop type changed from `() => Promise<Game[]>` to `(offset: number, size: number) => Promise<PageResult>`. The functions in `psnStore.ts` already match. No changes needed in `App.tsx` since the function references are passed directly.

**Step 5: Run full quality gates**

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`
Expected: ALL PASS. If there are type errors in test files that mock the old `fetch` signature, update them.

**Step 6: Commit**

```bash
git add client/src/components/Games.tsx client/src/components/Games.css client/src/modules/psnStore.ts
git commit -m "feat: add infinite scroll with IntersectionObserver"
```

---

### Task 7: Final quality gate + cleanup

**Step 1: Run all quality gates**

```bash
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

Expected: ALL PASS

**Step 2: Remove dead code**

Check for any remaining references to removed code:
- `filterGamesByGenre` — should have no imports left
- `withProductReleaseDates` — deleted
- `ensureNonEmpty` — deleted
- `isConceptPlus` — should not be imported in gamesService
- `fetchProductReleaseDate` — only used by `fetchProductDetail` delegation, which is fine
- `MIN_ITEMS` constant — should be deleted if `ensureNonEmpty` is gone

Run: `npm run lint && npm run typecheck && npm run test -- --run && npm run build`

**Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "chore: remove dead code from filter and enrichment removal"
```
