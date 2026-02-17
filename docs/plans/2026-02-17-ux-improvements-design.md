# UX Improvements Design

**Date:** 2026-02-17
**Goal:** Fix performance, redesign game cards, add infinite scroll, improve discount visibility, and clean up UI.

---

## 1. Performance — Remove listing enrichment

**Problem:** On cold start, `withProductReleaseDates` makes up to 120 individual `fetchProductReleaseDate` calls (2 concurrent, 6s timeout each) for every listing page. This is the primary performance bottleneck.

**Root cause:** The mapper already extracts `products[0].releaseDate` from the `categoryGridRetrieve` response. The individual enrichment calls are redundant for listings.

**Fix:** Remove `withProductReleaseDates` from the listing pipeline entirely. The concept's inline release date is sufficient for card display. Keep `fetchProductDetail` only on the PDP (detail page) where we enrich genres and description.

**Result:** Each listing tab drops from 120+ API calls to 1 single API call. Cold start goes from 30-60s to under 2s.

**Files:** `server/src/services/gamesService.ts`

## 2. Compact GameCard redesign

**Problem:** Cards are too large. Images fill available width, detail info has unnecessary whitespace.

**Fix:**
- Max card width 250px, square 1:1 image via `auto-fill` grid with `minmax(180px, 250px)`
- Remove genres from listing card (shown on PDP only)
- Compact info area: game name (bold, 2-line clamp), then date left-aligned and price right-aligned on one line
- Remove all extra padding/min-heights

**Layout:**
```
┌──────────────────┐
│  Image (1:1)     │
├──────────────────┤
│ Game Name        │
│ 15 Jan 2025 €49,99│
└──────────────────┘
```

**Files:** `client/src/components/GameCard.tsx`, `client/src/components/GameCard.css`, `client/src/components/Games.css`

## 3. Remove genre filter + rename brand

**Genre filter:** Remove the entire filter bar (the "All" button and genre pills) from `Games.tsx`. Drop the filter state, `filterGamesByGenre` usage, and filter button UI. Games always show unfiltered.

**Brand:** Change "PS5 Catalog" to "PS Store" in `AppShell.tsx`.

**Files:** `client/src/components/Games.tsx`, `client/src/components/Games.css`, `client/src/components/AppShell.tsx`

## 4. Discount display on cards

**Problem:** Cards only show the current price with no discount context.

**Fix:** Add two new fields to the shared game schema:
- `originalPrice: string` — the base price (empty string if no discount)
- `discountText: string` — e.g. "–20 %" (empty string if no discount)

The mapper sets these from `concept.price.basePrice` and `concept.price.discountText` when the concept is discounted.

Card display: when `originalPrice` differs from `price`, show original with strikethrough styling followed by current price in bold. Non-discounted items show a single price.

**Files:** `shared/src/schemas/game.ts`, `server/src/sony/mapper.ts`, `client/src/components/GameCard.tsx`, `client/src/components/GameCard.css`

## 5. Simplify Plus tab

**Problem:** `getPlusGames` has complex fallback logic (`ensureNonEmpty`, double `isConceptPlus` filtering) that's unnecessary since the query strategy already filters by `subscriptionService:PS_PLUS`.

**Fix:** Simplify to match other tabs — fetch concepts, map to games, filter released, sort by date descending. Remove `ensureNonEmpty` and the redundant `isConceptPlus` filter. The PS Plus catalog has 6700+ games so emptiness isn't a concern.

**Files:** `server/src/services/gamesService.ts`

## 6. Infinite scroll with server-side pagination

**Problem:** Server fetches 120 items at once, client renders all of them. No pagination.

**Server changes:**
- Add `?offset=0&size=60` query params to all listing endpoints
- Default size=60, max size=120, default offset=0
- Pass size/offset through to `fetchConceptsByFeature` which already supports `pageArgs`
- Return response envelope: `{ games: Game[], totalCount: number, nextOffset: number | null }`

**Client changes:**
- Change `fetch` prop signature to accept `(offset: number, size: number) => Promise<PageResult>`
- Fetch first 60 games on mount
- Use `IntersectionObserver` on a sentinel element at the bottom of the grid
- When sentinel enters viewport, fetch next page and append
- Show a small spinner while loading more
- Stop when `nextOffset` is null

**Files:** `server/src/api/gamesRoutes.ts`, `server/src/services/gamesService.ts`, `server/src/validation/schemas.ts`, `client/src/components/Games.tsx`, `client/src/modules/psnStore.ts`, `shared/src/schemas/game.ts` (page result type)

---

## Out of Scope

- PS Plus monthly game identification (Sony API doesn't distinguish monthly from catalog)
- Search functionality (already removed)
- Genre enrichment on listing cards (genres moved to PDP only)
