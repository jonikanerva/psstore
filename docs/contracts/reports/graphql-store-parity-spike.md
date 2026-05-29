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

### B.1 NEW-list defect: recent releases stranded beyond the fetch prefix (SUPERSEDES the B conclusion for NEW)

**Verified bug.** A genuinely recent PS5 release — "007 First Light" (concept
`10006560`, products `EP3969-PPSA11386_00-007FIRSTLIGHT000` /
`…007FLDELUXE00000`, release date `2026-05-26`; queried `2026-05-29`) — does NOT
appear in NEW. Root cause: `getNewGames` fetched only the first 120 concepts of
the grid (category `d0446d4b`, `sortBy conceptReleaseDate desc`,
`filterBy ["targetPlatforms:PS5"]`), THEN enriched + filtered `released` +
re-sorted. But `conceptReleaseDate`-desc is only DAY-granular and mixes past +
future at the head — it is NOT real-date-newest-first. 007 sat at grid position
**126**, beyond the 120 cap, so it was never fetched. The app sliced a blind
120-prefix of a 7,213-concept grid.

**Discovered mechanism.** The `categoryGridRetrieve` response `facetOptions`
advertises a `conceptReleaseDate` facet with key `last_thirty_days` (displayName
"Juuri julkaistut", live count **177**) — the released twin of the
`next_thirty_days` token the UPCOMING strategy already uses, callable
anonymously with no auth. Adding it to NEW's `filterBy` returns exactly the
released PS5 window (0 future, 0 undated, 0 dropped by the product-id regex; 007
lands at position 28).

**Fix shipped (branch `fix/new-list-recent-releases`, stacked on this branch).**

- `server/src/sony/queryStrategies.ts`: the `new` strategy now sets
  `filterBy: ["targetPlatforms:PS5", "conceptReleaseDate:last_thirty_days"]`,
  the structural twin of the shipped `upcoming` strategy. Keeps
  `sortBy conceptReleaseDate desc` from `baseVariables`. This is the only
  upstream-contract change; only `filterBy` VALUES change, so the persisted-query
  hash, operation name, variable schema, response path, and headers are
  unchanged and the contract validator / `sony:diff --ci` stay green. The facet
  token is inline (exactly like `next_thirty_days`) — no new env var
  (`AGENTS.md §14.1`, smallest-surface).
- `server/src/services/gamesService.ts`: NEW now fetches `NEW_LIST_PAGE_SIZE =
  300` (above the bounded ~177 set, one request, growth headroom). UPCOMING /
  DISCOUNTED / PLUS keep `LIST_PAGE_SIZE = 120`. The pipeline order is unchanged
  (map → enrich → `released` filter → `date-desc` sort → paginate); the
  `released` filter becomes a defensive near-no-op and the intraday `date-desc`
  re-sort + stable tiebreaker (B above) still matter (grid is day-granular).
  `getNewGames(offset=0, size=60)` signature is unchanged.

**This SUPERSEDES the §B conclusion for NEW.** The prior conclusion ("do not
chase parity / keep the blind 120-prefix + tiebreaker") correctly rejected
official-BROWSE parity, but it lacked the `last_thirty_days` facet evidence. The
facet is the VISION-aligned, released-only, newest-first INPUT set the prior
manual approach was approximating over the wrong (unbounded, future-mixed) grid
prefix. The §B tiebreaker and `released`/`date-desc` semantics are retained; only
the candidate INPUT set is corrected. The scope filters (`targetPlatforms:PS5`,
`PRODUCT_ID_PATTERN`, `released` `ts <= now`) are NOT loosened — the fix widens
the input, it does not weaken any filter (ux-guardian binding constraint). NEW
and UPCOMING stay cleanly separated (no pre-orders in NEW).

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

---

## D. Per-view findings (2026-05-29) — PLUS drop, UPCOMING fix, DISCOUNTED fix

Shipped in branch `fix/remove-plus-fix-upcoming-discounted`. All findings below
were observed against the anonymous fi-fi proxy (region `fi`, locale `fi-fi`,
EUR, PS5). Privacy-clean: operation names, public persisted-query hashes
(already in `env.ts`), variable shapes, field paths, category / concept ids,
counts, and prose only — no headers, cookies, tokens, IP addresses, or PII.

### D.1 NEW — healthy

The `conceptReleaseDate:last_thirty_days` facet input (section B.1) returns the
bounded released PS5 window (~178 live). The pipeline (map → enrich → `released`
gate → `date-desc` sort → paginate, `NEW_LIST_PAGE_SIZE = 300`) is unchanged and
correct. No NEW change in this branch.

### D.2 UPCOMING — funnel and the trailing-edge stranding fix

- The `conceptReleaseDate:next_thirty_days` facet returns ~53 concepts.
- ~41 of those are pure announcements: `products: []`, `price: null`, and no
  anonymous release date. They have no product SKU id, so the SKU-gated shared
  mapper (`PRODUCT_ID_PATTERN`) drops them for NEW / DISCOUNTED. They have no
  *internal* product PDP (no product SKU for `metGetProductById`) — but Sony's
  anonymous `/en-fi/concept/{id}` page DOES resolve and is the outbound link
  target for these titles (see §D.5). The ~12 SKU-bearing concepts are the
  priced, internally-linkable subset.
- **Defect.** `getUpcomingGames` ran a redundant per-product `> now` re-filter
  (`DateFilter 'upcoming'`) on top of the facet window. A concept inside the
  facet's 30-day window whose enriched `releaseDate` had already slipped just
  into the past (between Sony's grid snapshot and our enrichment call) was
  stranded — live: 7 of the 12 SKU-bearing concepts were dropped, leaving only
  ~5.
- **Fix.** `DateFilter` switched to `'none'`: the facet is the authoritative
  window, so the per-product re-filter is removed. `enrichGamesWithDates` still
  drops empty-date games (the ~41 announcements stay excluded). Result lifts
  ~5 → ~12. Sort stays `date-asc`. No upstream-contract change.

### D.3 DISCOUNTED — window, non-game SKUs, sort, and the corrected fix

- The deals category (`SONY_DEALS_CATEGORY_ID`, `filterBy ["targetPlatforms:PS5"]`)
  first page returns ~100–120 mixed products. The grid concept carries no
  `storeDisplayClassification`; that field lives on the `metGetProductById`
  (`data.productRetrieve`) response (section A.2).
- **Defect 1 (non-game SKUs).** Without a classification gate, DISCOUNTED leaked
  add-on packs, virtual currency, vehicles, and standalone editions — all
  forbidden by `VISION.md → Non-Goals`. Live first-120 deals classify roughly as
  ~87 `FULL_GAME` + ~13 `GAME_BUNDLE`, with `ADD_ON_PACK` / `PREMIUM_EDITION` /
  `VEHICLE` / currency making up the remainder.
- **Defect 2 (date stranding).** DISCOUNTED reused NEW's `released` date gate,
  which strands valid future-dated deals (pre-order discounts).
- **Fix (corrected per devils-advocate rework).** DISCOUNTED gets a focused path:
  enrich each grid concept once via `metGetProductById`, reading BOTH the release
  date AND `storeDisplayClassification` in the same call (cached together under a
  new `product-meta:` key, distinct from the `release-date:` key NEW / UPCOMING
  use — no cross-feature collision). Keep only the allow-list
  `{ FULL_GAME, GAME_BUNDLE }`; drop the `released` gate (`DateFilter` effectively
  `'none'`); sort `date-desc`. `PREMIUM_EDITION` is excluded by default for
  edition de-duplication (one-line change to include). The allow-list is
  conservative: unknown / future classifications are excluded so a new non-game
  SKU type can never silently leak in. The N+1 enrichment stays (cached 6h,
  within `STACK.md §4`); its reduction is deferred to issue #44. `sales30` sort
  was NOT adopted — unverified.

### D.4 PLUS — `subscriptionService` ignored, view dropped

- The candidate PLUS strategy used
  `filterBy ["targetPlatforms:PS5", "subscriptionService:PS_PLUS"]` against the
  same `categoryGridRetrieve` operation.
- **Finding.** The `subscriptionService:PS_PLUS` filter is silently ignored:
  PS5-only, PS5 + PS_PLUS-filtered, and a deliberately bogus
  `subscriptionService:NOT_A_REAL_TOKEN` request all return the identical
  full-catalogue concept count (7214). No `subscriptionService` facet is
  advertised on the category `facetOptions`. The anonymous public GraphQL does
  not expose the monthly PS Plus catalogue without an authenticated session.
- **Conclusion.** Per the pre-committed `VISION.md → Open Questions` contingency
  (resolved 2026-05-29), the PS PLUS *catalogue view* is dropped; the product
  never adds authentication to obtain it. The PS Plus *price* display (cards +
  PDP, derived from `concept.price.serviceBranding / upsellText` in `mapper.ts`)
  is unaffected and remains a core principle — only the view/tab and its
  contract feature were removed.

### D.5 UPCOMING concept cards — owner ruling (option a, 2026-05-29)

This supersedes the §D.2 "~12 ceiling" conclusion. The earlier funnel framing
("announcement-only titles correctly excluded / out of scope") was a §14.1
conservative default; the human owner overruled it.

- **Split (verified live, this session).** The `next_thirty_days` PS5 grid
  returns ~52 concepts: ≈12 carry a product SKU + price (internal-PDP cards) and
  ≈40 are concept-only announcements (`products: []`, `price: null`, no anonymous
  date).
- **Concept page resolves anonymously (verified).**
  `GET https://store.playstation.com/en-fi/concept/{conceptId}` returns HTTP 200
  with a real named page (e.g. concept `10018729` "RunNGun", `10019188`
  "Rat Protocol"); a bogus id redirects to `/error`. The `en-fi` locale segment
  is the confirmed working form. So a concept-only title HAS a valid external
  link target even though it has no internal product PDP.
- **Owner ruling (option a).** UPCOMING shows ALL ~52: the ~40 concept-only
  titles are rendered without a price (displayed "Unknown") and link OUT to the
  Sony concept page (`target="_blank" rel="noopener noreferrer"`); the ~12 priced
  SKUs keep the internal PDP. NEW and DISCOUNTED are UNCHANGED — they still
  require a real product SKU + price (SKU-gated shared `mapConceptsToGames`).
  ux-guardian routed this as NEEDS-NARROWING to the owner, who chose option a.
- **Implementation invariants.** UPCOMING uses a dedicated
  `mapUpcomingConceptsToGames` (drops only id-less entries) and enriches dates
  ONLY for `idKind === 'product'`, so `metGetProductById` is NEVER called on a
  bare concept id. A concept deep-link to `/g/{conceptId}` still 404s
  (`getGameById` searches only SKU-gated sets) — that clean 404 is intended and
  locked by a regression test; concept ids must never resolve to an internal PDP.
- **§14.1 choices.** Undated concept cards sort after the dated SKU cards (Sony
  exposes no anonymous date for them; a concept-date operation is deferred); the
  outbound link uses Sony's concept page rather than any internal concept PDP.
