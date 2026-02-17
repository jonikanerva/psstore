# UI Bug Fixes Design

**Date:** 2026-02-17
**Goal:** Fix five broken UI behaviors: square card images, missing genres, empty PDP description, empty discounted page, broken search.

---

## 1. Image Cards (CSS fix)

**Problem:** Card images are not square; cover art renders at native aspect ratio.

**Root cause:** `GameCard.css` lacks aspect-ratio constraint. The MASTER image priority in the mapper is correct (matches Sony's browse page).

**Fix:** Add `aspect-ratio: 1; object-fit: cover` to the `.game-card--image-wrap` container. Hide the genre line when genres are empty instead of showing "Unknown genre".

**Files:** `client/src/components/GameCard.css`, `client/src/components/GameCard.tsx`

## 2. Search (GraphQL replacement)

**Problem:** Search returns no results for valid queries like "destiny".

**Root cause:** The `fetchSearchGames` function scrapes HTML from Sony's search page using regex patterns (`data-qa="search#productTile"`) that no longer match Sony's current page structure. A GraphQL-based `fetchSearchConcepts` function already exists but isn't used.

**Fix:** Replace `fetchSearchGames` with `fetchSearchConcepts` in the search service path. Search results go through the same `mapConceptsToGames` pipeline as other listings, giving them cover art, prices, and dates. Remove all HTML scraping code from `sonyClient.ts`.

**Files:** `server/src/services/gamesService.ts`, `server/src/sony/sonyClient.ts`

## 3. Discounted Page (Dedicated category)

**Problem:** Discounted page is empty despite active deals on the real store.

**Root cause:** The current approach filters the generic browse category (`d0446d4b-...`) with `pricePromotion:true`. This returns no results. Sony uses a dedicated deals category (`3f772501-f6f8-49b7-abac-874a88ca4897`).

**Fix:** Change the `discounted` query strategy to use the deals category ID. Drop the `pricePromotion:true` filter (the deals category contains only discounted items). Keep the `isReleased` filter to exclude pre-order deals. Relax the `isConceptDiscounted` guard since everything from the deals category is discounted by definition.

**Files:** `server/src/sony/queryStrategies.ts`, `server/src/services/gamesService.ts`, `server/src/config/env.ts`

## 4. PDP Enrichment (Genres + Description)

**Problem:** PDP page lacks genres and description. The "pelin tiedot" summary is missing.

**Root cause:** The `categoryGridRetrieve` response does not include genres or description. The mapper hardcodes `description: ''`. The current `fetchProductReleaseDate` only extracts `releaseDate` from the `metGetProductById` query.

**Fix:** Expand `fetchProductReleaseDate` into a richer `fetchProductDetail` that also extracts genres and description. Update the `ProductRetrieveResponse` type to include these fields. Enrich `getGameById` with the product detail data before returning. Degrade gracefully if the API doesn't return description (show PDP without it).

**Risk:** Sony's PDP description may come from a separate API call not yet captured. If `metGetProductById` doesn't return description, we need to capture a new operation hash. Implementation will investigate and degrade gracefully.

**Files:** `server/src/sony/sonyClient.ts`, `server/src/sony/types.ts`, `server/src/services/gamesService.ts`

## 5. HTML Scraper Cleanup

**Problem:** Dead code after search migration.

**Fix:** Remove `extractSearchGamesFromHtml`, `gameFromSearchTile`, `fetchSearchGames`, all regex constants (`SEARCH_TILE_RE`, `TELEMETRY_RE`, `IMAGE_RE`), `decodeHtml`, and `SearchTelemetry` interface from `sonyClient.ts`. Remove associated tests.

**Files:** `server/src/sony/sonyClient.ts`, `server/src/__tests__/sonyClient.test.ts`

---

## Out of Scope

- Genre enrichment on listing cards (accepted tradeoff for fast listings)
- Cards show no genre text when the API doesn't provide it
