# Research spike: Sony GraphQL capability map, store-parity, and PDP enrichment

Status: read-only spike (architect) + implementation (lead-dev). This document
is the durable audit trail for the PDP-enrichment fix and the listing-divergence
investigation shipped in branch `feat/pdp-enrichment-graphql-spike`.

Scope: the app's own anonymous, unauthenticated proxy of Sony's public fi-FI
GraphQL (region `fi`, locale `fi-fi`, EUR, PS5).

> Privacy note (per `VISION.md → Persistence and Privacy Posture` and
> `AGENTS.md §8`): this document records only operation names, public
> persisted-query sha256 hashes (already present in `server/src/config/env.ts`),
> variable shapes, response field names / paths, category and concept ids, and
> prose. It contains no request headers, cookies, tokens, IP addresses, or any
> PII. The persisted-query hashes are public client constants, not secrets.

---

## A. GraphQL capability map

All operations are issued as anonymous persisted queries against
`https://web.np.playstation.com/api/graphql/v1/op` (GET), with the
`x-apollo-operation-name` header set to the operation name and a
locale-override header derived from `SONY_LOCALE`.

### A.1 `categoryGridRetrieve` (the listing operation — in use)

- Persisted-query hash: `257713466fc3264850aa473409a29088e3a4115e6e69e9fb3e061c8dd5b9f5c6`
- Variables: `{ id, locale, pageArgs { size, offset }, sortBy { name, isAscending }, filterBy[], facetOptions[] }`
  - The app requests `sortBy: { name: "conceptReleaseDate", isAscending: false }` and `filterBy: ["targetPlatforms:PS5"]` (plus per-feature filters, see `queryStrategies.ts`).
- Root path: `data.categoryGridRetrieve`
- Returns:
  - `concepts[]` — `{ id, name, media[], price { basePrice, discountedPrice, discountText, serviceBranding, upsellServiceBranding, upsellText } }`
  - `products[]`
  - `pageInfo { totalCount, offset, size, isLast }`, `sortedBy`, `sortingOptions[]`, `facetOptions[]`
- **Critical limitation:** each `concept.products[]` entry contains ONLY `{ __typename, id }`. There is no `releaseDate`, `genres`, or `providerName` on the grid response. The app's `mapper.ts` reads `concept.products[0].releaseDate / genres / providerName`, which are therefore always `undefined` — list cards have no per-product date or genres until enrichment runs.

### A.2 `metGetProductById` (the PDP enrichment operation — in use)

- Persisted-query hash: `a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a`
- Variables: `{ productId }`
- Root path: `data.productRetrieve`
- Returns (fields relevant to this product): `releaseDate` (ISO), `publisherName`, `descriptions[]`, `combinedLocalizedGenres[]`, `localizedStoreDisplayClassification`, `storeDisplayClassification`, `platforms[]`, `media[]`, `concept { __ref }`, `contentRating`, `edition`, `topCategory`.
- This is the operation that carries the "game info" description and genres anonymously. No new operation or auth is needed for the PDP fix.

### A.3 `conceptRetrieveForCtasWithPrice` (not used)

- Returns `conceptRetrieve { id, defaultProduct { webctas { price { … } } }, products[], releaseDate { type, value }, isInWishlist }`. No descriptions / genres. Not called by this app.

### A.4 Out of scope (never called)

- The PDP "game info" panel on `store.playstation.com` is server-rendered from a `conceptRetrieve` whose hash is server-internal and not anonymously callable. We do NOT design around it; `metGetProductById` already carries the same description + genres.
- Authenticated identity operations (e.g. `oracleUserProfile…`) exist but are out of scope and never called — the product has no accounts (`VISION.md → Non-Goals`).

### A.5 Field usage matrix

| Field path                                                  | Source op              | App uses it?  | Where                              |
| ----------------------------------------------------------- | ---------------------- | ------------- | ---------------------------------- |
| `categoryGridRetrieve.concepts[].id / name / media / price` | `categoryGridRetrieve` | Yes           | `mapper.ts → conceptToGame`        |
| `categoryGridRetrieve.concepts[].products[].id`             | `categoryGridRetrieve` | Yes           | product id for enrichment / detail |
| `categoryGridRetrieve.concepts[].products[].releaseDate`    | `categoryGridRetrieve` | No (absent)   | always undefined on grid; ignored  |
| `categoryGridRetrieve.concepts[].products[].genres`         | `categoryGridRetrieve` | No (absent)   | always undefined on grid; ignored  |
| `productRetrieve.releaseDate`                               | `metGetProductById`    | Yes           | listing date enrichment + PDP      |
| `productRetrieve.publisherName`                             | `metGetProductById`    | Yes           | PDP `studio`                       |
| `productRetrieve.descriptions[]` (LONG / SHORT)             | `metGetProductById`    | Yes (FIXED)   | PDP `description`                  |
| `productRetrieve.combinedLocalizedGenres[]`                 | `metGetProductById`    | Yes (FIXED)   | PDP `genres`                       |
| `productRetrieve.descriptions[]` (COMPATIBILITY/LEGAL)      | `metGetProductById`    | No (excluded) | never user-facing copy             |

---

## B. Listing divergence — root cause and VISION-aligned conclusion

**Report.** The app's category id `d0446d4b-…` and the official "All games"
category id `28c9c2b2-cecc-415c-9a08-482a605cb104`, queried with the same hash,
sort, and filter, return identical head ordering; the official browse page
renders that same order. So the server order the app receives IS the official
browse order.

The divergence is introduced entirely by client-side post-processing in
`gamesService.ts`:

1. Grid concepts carry `products[0] = { __typename, id }` only, so the mapper
   sets `date = ''` for every list item.
2. `getNewGames` runs `enrichGamesWithDates` — one `metGetProductById` call per
   item — to backfill per-product `releaseDate`.
3. The result is re-sorted purely by that per-product `releaseDate` and filtered
   to released items (`date <= now`).

The official `conceptReleaseDate`-desc head is dominated by FUTURE / placeholder
dates (e.g. `2027-01-20`; long runs of YEAR-precision `2026-12-31` placeholders),
which is why the official browse head looks alphabetical. `VISION.md → Product
Shape #1` requires NEW to be "released today at top, then yesterday, descending
by release date" — released-only, true newest-first.

**Conclusion.** The app and the official browse answer different questions.
Chasing byte-for-byte parity with the official browse head would surface undated
FUTURE placeholders at the top of NEW and would VIOLATE the VISION default view.
We do NOT chase official-browse parity.

**`AGENTS.md §14.1` interpretation (smallest-surface, most-conservative,
VISION-aligned):**

- Keep the `released` filter and `date-desc` sort for NEW. This is correct per
  VISION.
- Make ONE genuine correctness improvement: the re-sort now uses the upstream
  `conceptReleaseDate`-desc grid order as a STABLE tiebreaker, and unparseable /
  missing dates sort to a fixed sentinel rather than producing `NaN`
  comparisons. Before this change, equal or unparseable dates reordered
  nondeterministically across requests (implementation-defined `Array.sort`
  behaviour on `NaN` / `0` comparators). After it, ties deterministically keep
  the official grid order Sony already returns.
- We do NOT switch `SONY_CATEGORY_ID` (the optional `28c9c2b2-…` swap, 7578 vs
  7208 concepts, is not adopted — no VISION benefit and it would not change the
  released-newest-first answer).
- We do NOT refactor the N+1 enrichment (a separate optimization, out of scope).
- All existing SKU filtering (non-game / non-PS5 / DLC / editions / currency /
  themes / PS4) is preserved unchanged — "align with official" never means
  "stop filtering" (ux-guardian guardrail).

---

## C. PDP enrichment — the real bug

**Root cause.** `server/src/sony/sonyClient.ts → extractProductDetail` read
response fields that do not exist on `data.productRetrieve`
(`product.genres`, `product.longDescription`, `product.description`), so the PDP
description was always `''` and genres always `[]`.

**Real response shape** (confirmed from the live capture; see the sanitized
fixture `docs/contracts/samples/pragmata-pdp-descriptions-genres.json`):

- Long description: `productRetrieve.descriptions[]` is an array of
  `{ type, subType, value }` where `type ∈ "SHORT" | "LONG" |
"COMPATIBILITY_NOTICE" | "LEGAL"`. Use the `LONG` entry's `.value`; fall back
  to the `SHORT` entry's `.value`; never use `COMPATIBILITY_NOTICE` or `LEGAL`.
  (Live: ~922 chars for concept `10016790`, ~1571 for PRAGMATA.) The LONG value
  contains HTML (`<br>`, links) and is sanitized via DOMPurify in
  `client/src/components/GameDetailsPage.tsx` — that sanitization is kept.
- Genres: `productRetrieve.combinedLocalizedGenres[]` is an array of `{ value }`
  (typename `LocalizedGenreSubGenre`). Map to `.value`, drop empties. (Live
  fi-FI: `["Toiminta", "Roolipelit", "Kolmannen persoonan ammuntapeli"]`.)
- `releaseDate` and `publisherName` already worked and are unchanged.

**Fix shipped.**

- `server/src/sony/types.ts`: `ProductDetail` now models `descriptions[]` and
  `combinedLocalizedGenres[]` (the non-existent `genres` / `description` /
  `longDescription` fields are removed).
- `server/src/sony/productDetailSchema.ts` (new): a tolerant zod boundary schema
  for the `productRetrieve` node — all fields optional, `z.looseObject` (the
  non-deprecated Zod 4 replacement for `.passthrough()`) — so a Sony shape
  change degrades to empty values instead of throwing
  (`STACK.md §7`, `AGENTS.md §6.1`). `extractProductDetail` parses through it and
  degrades to empty description / genres on parse failure.
- `server/src/sony/sonyClient.ts → extractProductDetail`: rewritten to read the
  real field paths while returning the unchanged `ProductDetailResult` shape, so
  `gamesService` wiring is untouched.
- `client/src/components/GameDetailsPage.tsx`: confirmed to already render
  `game.description` (DOMPurify-sanitized) and `game.genres` conditionally — no
  client change required.
- The shared `Game` schema already has `description: string` and
  `genres: string[]` — no schema change required.

**Manifest contract note.** `metGetProductById` (`data.productRetrieve`) is
intentionally NOT added to `docs/contracts/sony-graphql-manifest.json`. The
contract-bot validator (`tools/sony-contract-bot/src/compat/backend.ts`) asserts
every manifest operation's `response_path` is one of
`data.categoryGridRetrieve.products` / `.concepts`; the PDP operation lives
outside that grid-only contract by design and is documented here instead.
