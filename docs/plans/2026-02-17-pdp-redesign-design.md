# PDP Page Redesign

## Problem

The Product Detail Page (PDP) has several issues:

1. **Missing publisher** — `enrichGameWithDetail` never maps `publisherName` from the product detail API, so studio shows "-"
2. **Missing genres** — genres from the detail API may not be reaching the client correctly
3. **Missing description** — `longDescription` from the product detail API should provide this
4. **Broken Metacritic URL** — uses old format `/search/game/{name}/results?plats...` which no longer works
5. **Suboptimal layout** — description appears before screenshots/videos; media should be more prominent

## Changes

### 1. Server: Map publisher from product detail

**File:** `server/src/sony/sonyClient.ts`

- Add `publisherName` to `ProductDetailResult` interface
- Extract `publisherName` from `product.publisherName` in `extractProductDetail`

**File:** `server/src/services/gamesService.ts`

- Update `enrichGameWithDetail` to set `studio` from `detail.publisherName` when available

### 2. Client: Fix Metacritic URL

**File:** `client/src/modules/psnStore.ts`

- Change `metacriticLink` to: `` `https://www.metacritic.com/search/${encodeURIComponent(name)}/` ``

### 3. Client: Reorder PDP layout

**File:** `client/src/components/GameDetailsPage.tsx`

New section order:
1. Title + key info (cover, price, publisher, genre, release date, action buttons)
2. Screenshots & Videos (media gallery) — moved up
3. Description — moved down

### 4. Client: Improve key info display

**File:** `client/src/components/GameDetailsPage.tsx` and `GameDetailsPage.css`

- Structure meta fields with clear label/value pairs
- Hide fields that have no data instead of showing "-" or "Unknown genre"
