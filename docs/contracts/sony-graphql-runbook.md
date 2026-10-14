# Sony GraphQL Contract Runbook

## Scope (Locked)

This tooling always targets the public Finnish storefront with fixed scope:

- region: `fi`
- currency: `EUR`
- platform: `PS5`

The contract is the Finnish store. The contract bot captures from the `fi-fi` public
storefront. The server requests data with `en-fi` (English content, same store). The
response shapes are identical. To check this by hand, run `pnpm test:live`.

Capture, `pnpm sony:refresh`, and the anonymous probes use no sign-in. One tracked operation is signed-in: the library list.
It has a separate owner-run check. See Signed-in library operation below.

## Refresh contract snapshot

```bash
pnpm run sony:refresh
```

Pipeline:

1. capture traffic from public `fi-fi` routes
2. normalize into candidate manifest
3. filter non-PS5 / non-EUR operations
4. validate schema + backend compatibility
5. generate diff report

The Sony contract values (the endpoint, the operation names, the hashes, the sign-in values,
and the locale) are in `docs/contracts/sony-constants.json`. The bot and the server read this file.
The server compiles it in, so a changed value needs a new server build.
The backend compatibility check compares the manifest with this file. It also checks that the
production code in `crates/server/src/sources/sony/`, `crates/domain/src/mapper.rs`, and
`crates/server/src/application/games.rs` still uses each operation. Test files and test modules do not count.

## Tracked operations

The manifest holds only the operations the server calls:
`categoryGridRetrieve`, `metGetProductById`, `productRetrieveForCtasWithPrice`, `getSearchResults`,
and the signed-in `getPurchasedGameList` and `storeRetrieveWishlist`.
The normalizer drops every other operation Sony fires on a captured page.
The list lives in `tools/sony-contract-bot/src/contract/trackedOperations.ts`.

The scope filter drops a grid request whose `filterBy` has no PS5 token.
Sony fires the category grid twice per page, once with an empty `filterBy`
and once with `targetPlatforms:PS5`. Only the PS5 request reaches the manifest.

## Search operation

The `search` feature route opens `https://store.playstation.com/fi-fi/search/<fixed sample term>`.
The page fires `getSearchResults` as an anonymous GET. The page calls the endpoint with a
double slash (`/api/graphql/v1//op`). The server uses the single-slash URL from `SONY_GRAPHQL_URL`.
Both URLs work.

The variables are `countryCode`, `languageCode`, `nextCursor`, `pageOffset`, `pageSize`, and `searchTerm`.
The page size limit is 50. Sony returns a validation error for a larger value.
Paging works with `pageOffset` and an empty `nextCursor`. `data.universalSearch.pageInfo` carries `isLast`.

The search request has no platform filter variable. Sony returns PS4-only titles too.
The scope filter therefore keeps an operation that has no PS5 token and no other platform token.
The server narrows the results at decode: `platforms` must include `PS5`, and
`storeDisplayClassification` must be a game class. The sample term must not contain a platform,
locale, or currency token, because the scope filter matches those tokens inside every variable value.

If Sony rotates the hash, the server log tag `UpstreamQueryRotated` names `getSearchResults`, and the API answers HTTP 502 with the problem code `upstream_query_rotated`.
Update `SONY_SEARCH_HASH` in `docs/contracts/sony-constants.json` and run `pnpm sony:refresh`.

The golden fixture is `crates/server/tests/fixtures/searchResults.golden.json`.

## Product page operation

The store product page no longer fires `metGetProductById`, so capture cannot see it.
The server still calls it. Refresh therefore probes it live: one anonymous GET with
the operation name and hash from `docs/contracts/sony-constants.json`, a sample product id from the canonical manifest,
and the same headers the server sends. The probe expects HTTP 200 and `data.productRetrieve`.
If the capture does not hold the operation and the probe passes, the manifest entry carries
over with that hash. If the capture holds the operation, no probe runs.
The compatibility check is unchanged.

If the probe fails, refresh stops and names the operation and the hash. Find the new hash
in the store, update `SONY_PRODUCT_BY_ID_HASH` in `docs/contracts/sony-constants.json`, and run
`pnpm sony:refresh` again. See Failure handling below.

## Signed-in library operation

The server calls `getPurchasedGameList` with the user's access token for the PURCHASED view.
Capture cannot reach it, and the anonymous probe cannot call it.
The manifest therefore holds a hand-written entry with feature `purchased`.
Its variables, header list, and response path mirror the server request. All values are synthetic.
The entry has no `authorization` header. `observed_status_codes` is empty, because nobody observed it live.

Refresh carries the entry over from the canonical manifest. It sets the hash from
`SONY_PURCHASED_HASH` in `docs/contracts/sony-constants.json` and runs no probe.
Refresh prints `carried over, NOT verified live`.

The compatibility check compares the operation name, the hash, the response path, and the variables
with `docs/contracts/sony-constants.json` and the Sony client in `crates/server/src/sources/sony/`. It guards repository-internal consistency only.
It does NOT detect Sony drift for this operation. Only a live check by the owner can do that.
The owner runs the live check with their own NPSSO. See the probe below.

```bash
SONY_NPSSO=<your NPSSO> pnpm sony:probe-purchased
```

- The probe is owner-run. An agent never holds a real NPSSO and never runs it.
- The probe reads the NPSSO only from the `SONY_NPSSO` environment variable.
  It does not read a `.env` file and takes no command-line argument.
- The probe checks the NPSSO format before it sends any request.
- The probe exchanges the NPSSO for an access token. It requests one library item.
- A PASS needs HTTP 200, no `PersistedQueryNotFound`, and a `data.purchasedTitlesRetrieve.games` array.
- On PASS the probe sets the hash from `docs/contracts/sony-constants.json` and
  `observed_status_codes` to `[200]` in `docs/contracts/sony-graphql-manifest.json`.
  Commit that change. The probe writes the file in the Prettier format.
- When the manifest already holds these values, the probe does not write the file.
- On FAIL the probe writes nothing.
- The output is one line: operation name, status code, and PASS or FAIL. A FAIL line adds a fixed error tag.
  The output never holds the NPSSO, a code, a token, a header, or a response body.
- Never schedule or automate the probe (STACK.md §9).

Hash rotation: when `getPurchasedGameList` answers `PersistedQueryNotFound`,
the owner captures the new hash from a signed-in session of the store, updates
`SONY_PURCHASED_HASH` in `docs/contracts/sony-constants.json`, and runs the probe again.
Commit the hash and the manifest together.

The diff report prints `purchased: unobserved (owner probe pending)` while
`observed_status_codes` is empty, so an empty list never reads as a pass.

## Signed-in wishlist operation

The server calls `storeRetrieveWishlist` with the user's access token for the WISHLIST view.
It is one GET request with no variables and no paging. The response list is `data.storeWishlistSecure`.
The operation is read-only. The server and the tooling never call or track `removeWishlistItem`.

The manifest holds a hand-written entry with feature `wishlist`. `observed_status_codes` is empty.
Nobody has seen an authorised answer yet. An anonymous request shows that Sony whitelists the hash:
the answer is HTTP 200 with an "Access denied" error and a `null` list.
An unknown hash gets HTTP 400 "not whitelisted", which the server reports as `UpstreamQueryRotated` (problem code `upstream_query_rotated`).

Refresh carries the entry over, like the purchased entry. It runs no probe.
The compatibility check guards the repository-internal name, hash, response path, and the empty variables only.

```bash
SONY_NPSSO=<your NPSSO> pnpm sony:probe-wishlist
```

- The probe is owner-run. An agent never holds a real NPSSO and never runs it.
- The probe follows the same rules as `sony:probe-purchased`.
- A PASS needs HTTP 200, no `PersistedQueryNotFound`, and a `data.storeWishlistSecure` array.
- An "Access denied" answer with a `null` list fails with the tag `access-denied`.
- On PASS the probe records `observed_status_codes: [200]` for `wishlist`. Commit that change.
- The probe never writes a wishlist.

The wishlist response has no region field, so the server ignores its prices.
It fills each product card (date, standard price, PS Plus price) from the anonymous Finnish store,
the same lookup as the game page. A concept entry or a failed lookup keeps a card with name and image only.

## PS Plus monthly feed

The MONTHLY view reads `https://www.playstation.com/bin/imagic/gameslist`, not the GraphQL
endpoint. The contract tooling does not capture it. A shape change shows as a
drift warning in the server log and as a failing MONTHLY step in `pnpm test:live`.
To refresh the golden fixture, download the feed anonymously and replace
`crates/server/tests/fixtures/plusMonthly.golden.json`. Do not store the response headers.

## Apply candidate as canonical manifest

```bash
pnpm run sony:normalize -- --write-manifest
pnpm run sony:validate
```

`--write-manifest` writes `docs/contracts/sony-graphql-manifest.json` in the Prettier format.

## Refresh cadence

Run a live capture **weekly** and review the result:

```bash
pnpm run sony:refresh
# then read the headline of:
docs/contracts/reports/latest-diff.md
```

On drift, follow the **Failure handling** entries below (re-capture, then commit
the updated hash constants in `docs/contracts/sony-constants.json` together with the
refreshed `docs/contracts/sony-graphql-manifest.json`).

**Why this is manual and weekly:** the `pnpm test-all` gate runs
`sony:diff -- --ci`, but in CI there is no candidate capture (`.sony-contract/`
is gitignored and CI never runs `sony:capture`), so that gate only compares the
canonical manifest **against itself** — it cannot detect live Sony drift. Its
report headline reads `Drift detected: UNKNOWN (no fresh capture …)` precisely
so a green CI run is never misread as "verified against live Sony". The weekly
manual `sony:refresh` is therefore the **actual live-drift detector**.

Do **not** automate this with a cron job or a GitHub Action — scheduled jobs are
out of scope (STACK.md §9). The cadence is a deliberate human step.

## Mandatory live check for boundary changes

Any change that touches the Sony decode/mapping boundary — specifically:

- `crates/server/src/sources/sony/**` (the client, the boundary decoders, rotation/429 handling), or
- `crates/domain/src/listing.rs` and `crates/domain/src/mapper.rs` (the mappers that turn
  decoded concepts into the renderable game list — #62's symptom was a mapping/filter outcome)

**MUST** run the live smoke suite against live Sony (`en-fi` requests) and record the counts in
the PR:

```bash
pnpm test:live
```

Paste into the PR the per-feature counts it logs (NEW / UPCOMING / DISCOUNTED / MONTHLY
concept counts, and the SEARCH counts for two terms plus the PS4-only title `bloodborne`) and the resolved PDP SKU. `pnpm test:live` is **not** part of
`pnpm test-all` (it is network/uptime-coupled — keeping it in the build would
make the build flaky).

**Why this is mandatory:** `pnpm test-all` **cannot** catch live Sony drift — it
decodes committed fixtures (`crates/server/tests/fixtures/*.golden.json`) and
compares the manifest against itself. Only `test:live` decodes a _fresh_ live
response through the production boundary, so it is the standing guard for the
#62-class regression (the null-tolerance bug that emptied UPCOMING/DISCOUNTED,
shipped in a PASS-reviewed PR and caught in production).

**Enforcement is the review gate, not automation** (owner ruling 2026-05-31:
manual, no CI). The `/codereview` step is the gate: a PR that touches the paths
above and does **not** include the `test:live` live counts should **FAIL**
review. This runbook is the reference for what "the live counts" means; it does
not imply any automated check closes the gap.

## CI checks

CI runs:

```bash
pnpm run sony:validate
pnpm run sony:diff -- --ci
```

Drift in CI is a hard failure.

## Redaction checklist (pre-commit)

- [ ] No `authorization` header in `docs/contracts/**`
- [ ] No `cookie` header in `docs/contracts/**`
- [ ] No bearer/API tokens in `docs/contracts/**`
- [ ] No NPSSO, access code, or access token in `docs/contracts/**` or in the probe output
- [ ] `.sony-contract/` remains untracked

## Failure handling

- Capture returns zero records: verify storefront reachability.
- Scope filtering removes all records: verify capture really includes `fi-fi` + PS5 + EUR signals.
- Validation mismatch: update manifest and backend mapping together.
- Drift detected: inspect `docs/contracts/reports/latest-diff.md` and triage operation changes.
- **PersistedQueryNotFound / `UpstreamQueryRotated` (HTTP 502, problem code `upstream_query_rotated`):** Sony shipped a new store build and the persisted-query hash rotated (Sony answers HTTP 200 + a top-level GraphQL `errors[]`; the backend classifies it as `UpstreamQueryRotated`). The hash is stale. Re-capture via `pnpm sony:refresh`, then commit the updated hash constants in `docs/contracts/sony-constants.json` together with the refreshed `docs/contracts/sony-graphql-manifest.json`.
- **`UpstreamRateLimited` (HTTP 503, problem code `upstream_rate_limited`):** Sony answered HTTP 429 and the single bounded retry did not clear it. Transient; no manifest action. The backend honours a clamped `Retry-After` (capped at the request timeout budget) — no token bucket is added (STACK.md §4 sets no budget).
