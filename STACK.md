# STACK.md — Rust / Axum backend + TypeScript / React / Vite frontend profile

Policy revision: 2

> A Rust service and a strict TypeScript SPA in one repository, served from one origin. Axum, Tokio, and Tower provide HTTP and concurrency. Utoipa exports OpenAPI 3.1; Hey API generates a TypeScript client with Zod validators. React, Vite, TanStack Router, and TanStack Query provide the browser application. Jiff represents time. The server keeps no durable data. One image contains the server binary and the built SPA files. **Normative** — MUST, MUST NOT, SHOULD, and MAY have the meanings in `DOCTRINE.md`; surface conflicts before deviating.
>
> This file adopts the agent-setup profile `stacks/STACK-RUST.md` (selection of 13 October 2026) with the project facts and the differences that §13 lists. `DOCTRINE.md` defines P1–P9. `CLAUDE.md` defines agent operation and authority. This file gives their concrete application for this project.

---

## 0. Project shape

- **Project risk rationale:** one owner uses the site as a personal PS5 store view. Railway deploys each merge to `main` (§15). The server has no persisted data, so most failures are recoverable by a fix, a Railway rollback, or a revert. The highest-risk surface is the Sony sign-in: the NPSSO is a full account credential (§2.5). A leak of the NPSSO cannot be undone by a revert. Upstream drift (Sony GraphQL, the PS Plus feed, IGDB) is the main correctness uncertainty; §14 → Live checks covers it.
- **Change risk:** assess the surfaces that each task affects against this rationale. A change to §2.5, to logging, or to caching of signed-in data is high risk. A risk label does not waive a required check or review.
- **Shape:** one Rust service and one browser SPA in a monorepo, served from one origin. The service is a read-only view of Sony's Finnish PS5 store with the user's own Sony lists.
- **Critical execution paths:** server request decode, the Sony and IGDB adapters, domain conversion, the service, and the response; browser route, API client, view, and render. Blocking work must not stall async I/O or the browser main thread.
- **Applicable UI states:** awaiting first data, success, empty, degraded (a stale persisted list while a refresh fails), offline, error, and signed-out for WISHLIST and PURCHASED.
- **Product reason for Rust:** ADR 0003 records it (memory use, the removal of unstable Effect HTTP modules, one stack with the owner's other Rust service).
- **Scope boundary:** product scope (from `VISION.md`) is enforced **structurally at the decode boundary, not in the UI**. Each source adapter decodes external data and narrows it into domain types before other code sees it. Anything outside scope is dropped at the boundary. Signed-in data follows the same rule (the purchased list and the wishlist hold PS5 games only). No user preferences, no server-side per-user state, no telemetry. Per-user data comes only from the Sony sign-in (§2.5). If a change cannot fit the scope, surface it rather than expanding it.

### Repository layout and boundaries

```text
repo/
  crates/
    domain/src/          # psstore-domain: store types, invariants, mapping and list rules
    server/src/          # psstore-server: HTTP, services, Sony and IGDB adapters, config, lifecycle
    server/tests/        # contract, live, and lifecycle tests; fixtures/
    server/examples/     # api_parity (and the e2e test server)
  packages/api-client/   # generated SDK, types, and Zod validators + a handwritten facade
  web/src/               # routes, views, components, client modules
  contract/openapi.json  # generated from the Rust routes and committed
  e2e/                   # Playwright and axe journeys against the test server
  tools/sony-contract-bot/  # captures and validates Sony's GraphQL contract
  docs/contracts/        # sony-constants.json, the Sony manifest, the runbook, API examples
  Cargo.toml  Cargo.lock  rust-toolchain.toml  clippy.toml  deny.toml  mise.toml
  pnpm-workspace.yaml  pnpm-lock.yaml  railpack.json  .config/nextest.toml
  STACK.md  VISION.md  DOCTRINE.md  CLAUDE.md
```

- `domain` MUST NOT depend on Axum, Tokio, Tower, reqwest, the server, or any I/O crate. It receives time and identifiers explicitly. It MUST NOT read the environment, the filesystem, the ambient clock, or random sources. Its own `crates/domain/clippy.toml` bans these as `disallowed-types` and `disallowed-methods` (`SystemTime`, `Instant`, `std::fs` files and functions, `std::process::Command`, `std::net` sockets, `jiff::Timestamp::now`, `jiff::Zoned::now`, the system time zone, `std::env` reads, `stdin`, `RandomState::new`). Its `ToSchema` derives are behind the `openapi` feature, which only the server enables.
- `server` owns effects, HTTP DTOs, the services, the adapters, the public error mapping, configuration, and process wiring. Handlers decode input, call one service, and return its mapped result. `wiring.rs` is the composition root: the only place that selects a concrete service.
- The domain values are also the wire values where the representations agree (`Game`, `GameDetail`, `PageResult`, `GenreList`). Ids that cross the crate boundary or the API have newtypes: `GameId`, `ProductId`, `ConceptId` (§13 lists the raw upstream ids that stay strings).
- `packages/api-client` owns the generated API artifacts and the facade. Generated files MUST NOT be edited by hand.
- `web` reaches the API only through `@psstore/api-client`. It MUST NOT import server code or keep a handwritten copy of a wire contract. An Oxlint `no-restricted-globals` rule bans `fetch` in `web/src`.
- Review-only gaps: `std::fs` functions and `std::io` streams that `clippy.toml` does not list, `env!` and `option_env!` (build time), and dependency internals.

---

## 1. Language & Runtime

### Backend

- **Language:** Rust 1.99.0, edition 2024, pinned in `rust-toolchain.toml` with rustfmt and Clippy. `[workspace.package]` declares `rust-version = "1.99"`; `crates/domain` inherits it, and `crates/server` repeats it (§13).
- **Runtime:** a native Linux binary in the Railway image (§15). A local macOS build does not validate the Linux artifact.
- **Package manager:** Cargo with workspace dependency inheritance (`[workspace.dependencies]`, exact `=x.y.z` pins). `Cargo.lock` is committed; every Cargo command that supports it uses `--locked`.
- **Strictness:** every crate has `[lints] workspace = true`. Clippy runs with `-D warnings`.

```toml
[workspace.lints.rust]
unsafe_code = "forbid"
unused_must_use = "deny"
unfulfilled_lint_expectations = "deny"
missing_debug_implementations = "warn"

[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
print_stdout = "deny"
print_stderr = "deny"
allow_attributes = "deny"
allow_attributes_without_reason = "deny"
let_underscore_must_use = "deny"
```

`clippy.toml` allows `unwrap`, `expect`, `panic`, and printing in tests; `dbg!` stays denied everywhere. A justified lint limitation uses a narrow `#[expect(clippy::lint_name, reason = "...")]`; a stale expectation fails verification. Lossless numeric casts are not banned as a class; the pedantic cast lints catch lossy ones.

### Frontend

- **Language:** TypeScript 7 (the native compiler). The profile's TypeScript 6 and typescript-eslint baseline is replaced by the profile's TypeScript 7 alternative: Oxlint with the type-aware tsgolint backend (§13).
- **`tsconfig.base.json`:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `moduleDetection: "force"`. The generated client directory has one scoped exception (§13).
- **Lint:** Oxlint `--type-aware --deny-warnings` with `.oxlintrc.json`: the strict type-aware TypeScript rules (`no-explicit-any`, the `no-unsafe-*` family, `no-floating-promises`, …) and the React hook rules `rules-of-hooks` and `exhaustive-deps` as errors.
- **Build-time runtime:** Node.js 24 LTS (24.21.0). Node runs the client build, the TypeScript tests, the generator, and the Sony contract tooling. The production image contains no Node.
- **Package manager:** pnpm 12.8.1 workspaces (`web`, `packages/*`, `tools/*`, `e2e`), committed `pnpm-lock.yaml`, frozen-lockfile installs. `pmOnFail: error` fails a pnpm version mismatch. `minimumReleaseAgeStrict: true` refuses a package release younger than the pnpm minimum age.

### Provisioning

Mise tasks are the bootstrap and the command interface (§3). A fresh macOS machine needs mise, rustup, and the Xcode Command Line Tools (the linker), then `mise trust` and `mise run setup` in the repository root. `rust-toolchain.toml` owns the Rust version (mise reads it as an idiomatic version file). `mise.toml` owns Node, pnpm, Gitleaks, cargo-deny, cargo-nextest, and cargo-shear. Mirrors change in the same commit: `.nvmrc` and `engines.node` (the floor) and `packageManager` in the root `package.json`, and the `packages` of `railpack.json` (§15). `mise run setup` installs the pinned tools, the locked pnpm and Cargo dependencies, and the Playwright Chromium build that matches the locked Playwright version.

---

## 2. Frameworks

| Concern                  | Technology                                            | Role                                                                        |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| HTTP                     | Axum, Tower, tower-http                               | Routing, extraction, request mapping, and the static SPA files (`ServeDir`) |
| Concurrency              | Tokio (current-thread runtime)                        | Async I/O, owned lookup tasks, the shutdown deadline (§9)                   |
| Domain errors            | `Result`, enums, thiserror                            | Expected failures with fixed texts                                          |
| Wire representation      | Serde and serde_json                                  | The API JSON; decoding of external sources (§2.3)                           |
| HTTP contract            | utoipa and utoipa-axum                                | OpenAPI 3.1 tied to the registered `/api` routes                            |
| Client generation        | Hey API with Zod                                      | SDK, wire types, and executed runtime validators                            |
| Time                     | Jiff                                                  | Instants and their parse and format (§10)                                   |
| Server cache             | `TtlCache` (`crates/server/src/application/cache.rs`) | In memory; capacity, a time to live per outcome, one shared lookup per key  |
| Outbound HTTP            | reqwest with Rustls                                   | Sony, the PS Plus feed, IGDB, and Twitch (§2.3)                             |
| Logging                  | tracing and tracing-subscriber                        | The allowlist layer: JSON lines, or readable text for development (§8)      |
| UI and build             | React 19, React DOM, Vite                             | The SPA                                                                     |
| Routing and server state | TanStack Router and TanStack Query                    | URL state and the query cache                                               |
| Styling                  | Tailwind CSS 4                                        | Utilitarian; no decorative chrome                                           |
| Tests                    | nextest, doctests, Vitest, Playwright with axe        | Behaviour, contracts, and critical journeys                                 |
| Formatting and lint      | rustfmt, Clippy, Prettier, Oxlint with tsgolint, tsc  | Named checks through mise                                                   |

### Server conventions (binding)

- **Functional core, imperative shell.** `crates/domain` holds the pure types and rules. I/O lives in `crates/server/src/sources/` (adapters) and `crates/server/src/http/` (the interface).
- **Dependency direction:** `http` → `application` → `domain`. `sources` implements the ports of `application` and uses `domain` types. A trait exists only at a real replaceable or testable boundary.
- **Errors are values.** A fallible operation returns `Result` with a thiserror enum whose `Display` text is fixed: never a credential, a URL, upstream text, or user input. No `panic!`, `unwrap`, or `expect` outside tests.
- **The compiler is the reviewer.** Newtypes for validated values (`GameId`, `ProductId`, `ConceptId`, `GenreKey`, `CriticScore`, `Secret`), exhaustive `match`, and `#[expect]` with a reason for every lint limitation.
- **External data is untrusted until decoded.** Each adapter decodes and narrows at the source boundary (§2.3). A missing or invalid value never becomes an invented value.
- **Handlers are thin:** validate the input (`crates/server/src/http/params.rs`), call one service, and return its typed outcome.
- **Contain panics.** A panic in request handling becomes the `internal_error` Problem Details 500; a panic in a cache lookup becomes an upstream failure that is not cached. The panic hook logs only the source location.

### 2.1 API contract and generation

1. `crates/server/src/http/openapi.rs` registers the twelve documented `/api` operations through utoipa-axum, so the document lists the routes that the router serves. Each operation documents every status that it can answer, including its Problem Details errors. The operational routes `/healthz`, `/readyz`, and `/version` are outside the contract.
2. `cargo run --locked -p psstore-server --bin openapi -- <path>` exports the document without environment, network, or SPA assets. The output is deterministic. `contract/openapi.json` is committed.
3. `packages/api-client` generates the SDK, the wire types, and the Zod validators from the committed document (`@hey-api/openapi-ts`, plugins client-fetch, typescript, zod, and sdk with Zod response validation) into `src/generated/`. The generated files and the document are committed and excluded from Prettier.
4. `mise run contract:check` exports the document and regenerates the client in a scratch directory and compares the complete trees, including added and deleted files. It never changes the working tree.
5. The facade (`packages/api-client/src/index.ts`) validates every success body and every error body in the call path. A 2xx body that breaks the contract, an empty 2xx body, an unknown error code, an invalid error body, and a non-JSON intermediary answer become typed errors (`invalid_response`, `unrecognized_error`). A known error code counts only when it matches its status. The facade forwards `AbortSignal`, and the signed-in calls use `cache: 'no-store'`.
6. A change to an API payload updates the examples in `docs/contracts/api/` in the same commit. Tests: `every_answer_of_a_documented_route_is_in_the_document` (`crates/server/src/http/tests.rs`) checks the real router answers of each operation against the document; `the_committed_openapi_document_matches_the_routes` (`crates/server/tests/api_contract.rs`) compares the committed document with the export; the API examples in `docs/contracts/api/` pass the Rust test (bytes and key order) and the generated Zod schemas (`packages/api-client`).
7. Null and optional fields: an always-present field that can be `null` is `required` and nullable; `criticScore` is optional and never `null`. Unknown keys in a response pass validation unchanged.
8. Compatibility: the server and the SPA deploy together. An old browser tab keeps the old bundle until it reloads; `index.html` is `no-cache`, so a reload gets the new bundle.

The build order is: export the document, generate the client, build the SPA, build the release server. The export does not depend on the SPA.

### 2.2 Errors and failure containment

Every `/api` failure answers RFC 9457 Problem Details with `content-type: application/problem+json`: `type: "about:blank"`, `title` (the RFC 9110 status phrase), `status`, a fixed `detail`, and a stable `code` extension. `crates/server/src/http/errors.rs` maps every error in one place, exhaustively, and `problem(ProblemCode)` builds the body.

| `code`                   | Status | Cause                                                                  |
| ------------------------ | ------ | ---------------------------------------------------------------------- |
| `invalid_request`        | 400    | An invalid query or path value, an invalid sign-in body                |
| `session_rejected`       | 401    | No usable `npsso` cookie, or a definitive Sony rejection (§2.5)        |
| `not_found`              | 404    | An unknown `/api` path, or another method on a documented `/api` path  |
| `game_not_found`         | 404    | No PS5 game has this id in the Finnish store                           |
| `payload_too_large`      | 413    | A request body over the 2 MiB limit                                    |
| `unsupported_media_type` | 415    | A sign-in body that is not JSON                                        |
| `internal_error`         | 500    | A contained panic                                                      |
| `upstream_unavailable`   | 502    | An upstream outage, timeout, unexpected answer, or broken contract     |
| `upstream_query_rotated` | 502    | Sony no longer knows a persisted-query hash (`mise run sony:refresh`)  |
| `upstream_rate_limited`  | 503    | Sony answered 429 after the retry budget; optional `retryAfterSeconds` |

No domain message, game id, media type, or upstream text reaches a response. An unknown `/api` path is a Problem Details 404 whatever the `Accept` header; it never falls back to `index.html`. A retryable classification does not authorise repeating a write; the only write is the sign-in, and it is never retried. Partial success: the list decoders (the category grid, search, the PS Plus feed, the purchased list, and the wishlist) decode each element on its own. An invalid element is dropped, and a warning logs the dropped count; inside one element, an invalid nested array fails that element. An invalid or missing envelope fails the whole request (502) for search, BROWSE, the genre list, the PS Plus feed, the purchased list, and the wishlist. A drifted category grid of NEW, UPCOMING, or DISCOUNTED gives an empty list and a `sony.categoryGrid.drift` warning, like the TypeScript server (§13). The tests cover one invalid element among valid ones (`categoryGridBrokenElement.golden.json`) and the envelope failure of each list.

### 2.3 Outbound sources

Each adapter decodes its source at the boundary and narrows it into domain types before other code sees it.

- **Transport** (`crates/server/src/sources/transport.rs`): each attempt has a deadline that includes the response body; a body over 16 MiB fails the attempt; a 429 retries after a `Retry-After` delay that is clamped to the attempt deadline; a 4xx answer fails at once; a 5xx answer, a timeout, or a connection failure retries within the budget. The account client (§2.5) makes no retry. A transport failure maps to a fixed message; the text of a reqwest error never reaches a message, a log, or a response. Every request sends `User-Agent: psstore/<version>`.
- **Sony store GraphQL** (`crates/server/src/sources/sony/catalog.rs` and `catalog/`): persisted queries on `https://web.np.playstation.com/api/graphql/v1/op`. The endpoint, the operation names, the hashes, the category ids, `SONY_LOCALE` (`en-fi`), and the sign-in constants are in `docs/contracts/sony-constants.json`; the server compiles the file in, and the contract tooling reads it. The decoders walk `serde_json::Value`, because a derived struct also accepts a JSON array in field order and fails on a repeated key, unlike the TypeScript server's schemas.
- **PS Plus monthly feed:** `https://www.playstation.com/bin/imagic/gameslist` with `locale=en-fi` and `categoryList=plus-monthly-games-list` (`catalog/monthly.rs`). It returns public JSON and sets a country cookie; the server never stores, forwards, or sends cookies or credentials to it. The contract tooling does not capture this feed. The drift guard is `crates/server/tests/fixtures/plusMonthly.golden.json` plus the MONTHLY count in `mise run test-live`.
- **IGDB critic score:** the game page shows one critic score. The server calls `https://api.igdb.com/v4/games` and, for the token, `https://id.twitch.tv/oauth2/token` (Twitch client credentials, in the form body, never in a URL). It sends only the public Sony title and the release-year range; never a cookie, a header, an IP address, or signed-in data. The score is attached to the game page response only (`GameDetail`), never to the list `Game`. The match rule is `crates/domain/src/critic_match.rs`. The score is `aggregated_rating` (critics), never `rating` (users). The drift guard is `crates/server/tests/fixtures/igdbGames.golden.json` (synthetic) plus the SCORE checks. Without `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` the feature is off. The IGDB and the account clients follow no redirect.

### 2.4 Frontend state

| State                                     | Owner                               |
| ----------------------------------------- | ----------------------------------- |
| Server data and client cache              | TanStack Query                      |
| Search term, sort, BROWSE genre and order | The router and validated URL values |
| Local interaction state                   | React                               |
| The sign-in input                         | The sign-in form; cleared on submit |
| Durable business data                     | None; Sony is the source of truth   |

The persister (`createSyncStoragePersister` on `localStorage`; `shouldDehydrateQuery` in `web/src/modules/persistence.ts`) keeps only the anonymous `games` and `game` queries. Signed-in queries live in memory only (§2.5). Stale times, retries, and refetch triggers are set explicitly per query. A failed fetch never becomes an empty successful result.

### 2.5 Sony sign-in & per-user data

The profile's OIDC sessions do not apply: Sony offers no public OAuth for third parties (§13). `VISION.md → Persistence and Privacy Posture` sets the policy. These rules fix the mechanics for every feature that uses the user's Sony sign-in. WISHLIST and PURCHASED use it. Both are read-only.

- **Credential:** the user pastes their NPSSO token into the sign-in form. The NPSSO flow is unofficial and undocumented. Treat the NPSSO as a full account credential. The reference for the exchange and for signed-in operations is the `psn-api` documentation (Context7 `/achievements-app/psn-api`). Adding `psn-api` itself as a dependency needs a §6 entry like any other package.
- **Exchange:** the client sends the NPSSO once, in a JSON request body, to `POST /api/session`. The route accepts a JSON content type or none and answers any other content type with the `unsupported_media_type` problem; it sends no CORS headers. The backend exchanges the NPSSO with Sony for a short-lived access token and discards the token at once. It keeps no refresh token and no id token: the decoder reads only `access_token` and `expires_in`. The response is an empty 204 with no token and no NPSSO in the body. The backend sets the sign-in cookie only after Sony accepted the NPSSO.
- **Cookie:** the cookie is named `npsso`. Its value is the NPSSO. Its attributes are `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000` (30 days). `DELETE /api/session` clears it with the same attributes and `Max-Age=0`. JavaScript cannot read it. The server never forwards, stores, or reads back a Sony `Set-Cookie`. The NPSSO payload is 16 to 512 characters from the cookie-safe set `A-Za-z0-9._~-`. `Secure` cookies work on `http://localhost` in Chrome and Firefox, not in Safari.
- **Client:** the client holds no token and no sign-in state of its own. The signed-in status derives from the `['purchased']` and `['wishlist']` queries: a 401 on either one shows the sign-in form in its view. A sign-in or sign-out resets the query that is not on screen. The reset itself makes no Sony call. The browser attaches the cookie. The client never reads `document.cookie` and never writes the NPSSO to `localStorage`, `sessionStorage`, IndexedDB, a URL, or a query key. The input field is cleared on submit. Both queries refetch on a user action, or in the prefetch below.
- **Prefetch:** after the open tab has loaded, the client fetches the other tabs one at a time, in the order UPCOMING, DISCOUNTED, MONTHLY, WISHLIST, PURCHASED (`usePrefetchTabs`). It skips BROWSE: BROWSE has no list until the user chooses a genre and an order. It fetches the first page of an anonymous tab. It uses the query keys and options of the views. It skips a tab that has data or that a view has open. It starts only after the cache restore ends and while no other fetch is active. A route change, or a fetch that another query starts, aborts the request in flight. The prefetch resumes when no other fetch is active. It never aborts a request that a view has joined. The HttpOnly cookie is unreadable, so the client cannot test the sign-in state. It requests WISHLIST and PURCHASED and accepts the answer. A 401 is silent: no sign-in form, no error, no entry in the cache. A 401 ends the signed-in prefetch for the page session. Any other failure ends all prefetch for the page session, with no retry. A sign-out aborts a signed-in request in flight and ends the signed-in prefetch. Signed-in answers stay in memory. The prefetch logs no signed-in data.
- **Requests:** a signed-in route reads the first `npsso` cookie of the request (`crates/server/src/http/session.rs`). A missing or empty cookie is a `session_rejected` 401 with no Sony call. The backend exchanges the NPSSO for a new access token on each request, forwards the token to Sony, and returns the decoded result. Concurrent requests with the same NPSSO share one in-flight exchange (`InFlight`, `crates/server/src/application/in_flight.rs`, keyed by the `Secret` value, no idle time to live). The shared entry ends when the exchange ends, before the library crawl; a drop guard also ends it when the exchange task panics. No access token is kept after that. There is no server session store.
- **Server types:** the NPSSO and the Sony access token are `Secret` values (`crates/domain/src/secret.rs`: `Debug` prints `<redacted>`; no `Display`, no `Serialize`) from the moment they are read. For the NPSSO and the Sony token, `Secret::expose` is called only where the value goes into an outbound Sony request and into the `Set-Cookie` value of the sign-in answer. The empty-cookie check runs before the value becomes a `Secret`.
- **Caching:** the sign-in exchange and the signed-in Sony responses never use the `TtlCache`, and no access token is retained between requests. The wishlist route also calls the anonymous public lookups of the games service, which cache public store data by public product id. No account value is in a key or a value. Never add a signed-in query to the client persister allow-list. Reset the `['purchased']` and `['wishlist']` queries on sign-out. The game page reads these two lists on a 404 only, to show an entry that the public store has no page for.
- **Scope:** signed-in responses are decoded and narrowed at the boundary. The purchased list keeps only an entry with platform exactly `PS5`, a non-empty name, and a valid product id. The library crawl reads pages of 100 in sequence. A library of more than 20 pages fails the request with 502 or 503; it is never cut short. The wishlist is one request with no paging. It keeps an entry only when its platforms include `PS5`, its name is not empty, and its id is valid for its `__typename` (a product id for `Product`, a concept id for `Concept`). The wishlist response has no region field, so its price strings are ignored. The server fills each product entry from the anonymous Finnish store lookup (6 at a time, 5 s per entry, 12 s for the list). A concept entry, a missing game, or a slow or failed lookup keeps a card with name and image only. A `null` or missing list without a definitive access-denied answer is drift (502), never an empty wishlist.
- **Errors:** only a definitive Sony rejection maps to the 401 and clears the cookie: an authorize redirect without a code, or a 401 or 403 from the token or library call. A 429 maps to 503. A 5xx, an unexpected answer, or a timeout maps to 502 or 503 and keeps the cookie. The client shows the sign-in form on a 401 only. No account call follows a redirect.
- **Contract:** the sign-in constants (`SONY_AUTH_*`), the operation names, and the hashes are in `docs/contracts/sony-constants.json`. Capture and live checks of signed-in operations need a real NPSSO, so the owner runs them (§14 → Live checks). `getPurchasedGameList` and `storeRetrieveWishlist` each have a hand-written synthetic manifest entry, which guards the repository-internal name and hash only. The server never calls a wishlist write operation.
- **Fixtures:** committed manifests, golden fixtures, examples, and test data never contain a real NPSSO, access token, refresh token, account identifier, or real signed-in response data. Use synthetic values.
- **XSS:** an XSS bug cannot read the NPSSO cookie, but it can still make requests as the user. Keep DOMPurify on every Sony-authored HTML string. Add no new `dangerouslySetInnerHTML`.

---

## 3. Build & verify commands

Mise tasks in `mise.toml` are the single source of truth. Commits, agent workflows, and any CI invoke these entry points. The root `package.json` keeps only thin aliases that call a task where `CLAUDE.md` or a habit names a pnpm command (`pnpm dev`, `pnpm start`, `pnpm test-all`, `pnpm test:live`, `pnpm sony:*`); they add nothing.

| Variable      | Command           |
| ------------- | ----------------- |
| `$FORMAT_CMD` | `mise run format` |
| `$LINT_CMD`   | `mise run lint`   |
| `$BUILD_CMD`  | `mise run build`  |
| `$TEST_CMD`   | `mise run test`   |
| `$VERIFY_CMD` | `mise run verify` |

- **format:** rustfmt and Prettier in write mode. `format-check` is the same in check mode.
- **lint:** `cargo clippy --workspace --all-targets --locked -- -D warnings`, Oxlint on `web/src`, `packages/api-client`, and `tools/sony-contract-bot/src`, and the type check of every TypeScript package.
- **build:** `contract:export`, `contract:generate`, the web build, the bot build, and `cargo build --release --locked -p psstore-server`.
- **test:** `cargo nextest run --workspace --locked` (it also runs the `api_parity` example tests), `cargo test --doc --workspace --locked`, Vitest in every TypeScript package, and the browser journeys (`test:e2e`).
- **verify:** `format-check` → `lint` → `contract:check` → `scan:secrets` → `scan:deps` → `build` → `test` → `sony:validate` → `sony:diff --ci`. It stops at the first failed step and changes no tracked file.
- **Other tasks:** `setup`, `dev` (the server with the text log format and Vite), `start` (the release binary from the repository root), `test-live` (§14), `contract:export`, `contract:generate`, `contract:check`, and the Sony tool tasks `sony:capture|normalize|validate|diff|refresh|probe-purchased|probe-wishlist`.

**Narrow test selectors** (for the mutation check): `cargo nextest run -p <crate> <test name filter>`; `pnpm --filter <package> test <test file>`.

---

## 4. Performance budgets

The owner set no budget (2026-10-13, ADR 0003: "ei mitata mitään"). The table keeps the profile's shape.

| Budget                         | Adoption value                                                 |
| ------------------------------ | -------------------------------------------------------------- |
| API latency and errors         | Not set (owner decision 2026-10-13)                            |
| Startup                        | Not set                                                        |
| Memory and resource saturation | Not set; Railway's memory metric is read after a release (§15) |
| Release size                   | Not set                                                        |
| Web experience                 | Not set                                                        |

Resource bounds that do exist: the response body limit (16 MiB), the request body limit (2 MiB), the cache capacities (product details 10 000, critic scores 5 000), the per-attempt deadlines, and the bounded lookup concurrency.

---

## 5. Persistence shape

- **Storage:** none on the server. The in-memory `TtlCache` (§2) has a time to live per outcome and no manual invalidation. No database, no on-disk persistence, no per-visitor state.
- **Client:** the TanStack Query cache is persisted to `localStorage` for the anonymous store queries only (§2.4). The one per-user value the browser keeps is the HttpOnly `npsso` cookie (§2.5).
- **Entities and retention:** declared by `VISION.md → Persistence and Privacy Posture`. Forbidden: accounts, user preferences, per-user state, telemetry, and anything else that `VISION.md` forbids.

---

## 6. Approved dependencies

Default answer to "should we add a library?" is **no**. Pin exact resolved versions: crates with `=x.y.z` in `[workspace.dependencies]` and `Cargo.lock`; packages through `pnpm-lock.yaml` (`minimumReleaseAgeStrict` refuses a release younger than the pnpm minimum age). A manifest keeps a caret range unless the table pins the package exactly. Upgrade deliberately. Enable only the features that the code uses. A new entry needs a `STACK.md` change with necessity, provenance, maintenance, licence, transitive cost, and replacement cost; a crate also needs a `cargo deny` pass and a note when it adds a build script or a proc-macro crate (§15 → Build-time variables). Ordinary library choices are delegated (`DOCTRINE.md` P2). "Lead #157" means the lead of the port (issue #157, ADR 0003) and of its profile alignment (ADR 0004), within the owner's decisions.

**Crates** (`[workspace.dependencies]`):

| Crate                              | Version              | Why it earns its place                                                                                                                            | Approver  | Date       |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| `axum`                             | `0.8.9`              | HTTP routing and extractors. Features `http1`, `json`, `matched-path`, `tokio`.                                                                   | Lead #157 | 2026-10-13 |
| `tokio`                            | `1.53.2`             | Async runtime, timers, signals, file access for static files; `test-util` pauses the clock in tests.                                              | Lead #157 | 2026-10-13 |
| `tower`, `tower-http`              | `0.5.3`, `0.6.11`    | Request mapping; `ServeDir` for the SPA. The profile line is tower-http 0.7; reqwest 0.13.5 depends on 0.6.11, so one version stays in the graph. | Lead #157 | 2026-10-13 |
| `reqwest`                          | `0.13.5`             | Outbound HTTPS with Rustls, gzip, query, and form support; a redirect policy per client.                                                          | Lead #157 | 2026-10-13 |
| `serde`, `serde_json`              | `1.0.229`, `1.0.151` | The API JSON and the decoding of external sources.                                                                                                | Lead #157 | 2026-10-13 |
| `thiserror`                        | `2.0.21`             | The expected error enums with fixed `Display` texts. Already in the graph through reqwest and rustls.                                             | Lead #157 | 2026-10-13 |
| `jiff`                             | `0.2.38`             | Instants and their parse and format. No time zone database: the server works in UTC.                                                              | Lead #157 | 2026-10-13 |
| `utoipa`, `utoipa-axum`            | `6.0.0`, `0.3.0`     | The OpenAPI 3.1 document from the registered routes. `macros`, `preserve_order`.                                                                  | Lead #157 | 2026-10-13 |
| `tracing`, `tracing-subscriber`    | `0.1.44`, `0.3.23`   | Structured events and spans; the allowlist layer (§8). Registry only.                                                                             | Lead #157 | 2026-10-13 |
| `uuid`                             | `1.26.1`             | The random request id (`v4`). Its random source is already in the graph through reqwest.                                                          | Lead #157 | 2026-10-13 |
| `futures-util`                     | `0.3.34`             | Shared futures for the cache and the in-flight exchange; `catch_unwind` for panic containment.                                                    | Lead #157 | 2026-10-13 |
| `form_urlencoded`                  | `1.2.2`              | Query decoding with the semantics of `URLSearchParams`. Already in the graph through `url`.                                                       | Lead #157 | 2026-10-13 |
| `icu_normalizer`, `icu_properties` | `2.3.0`, `2.3.0`     | The critic match rule: NFKD and the exact general categories `\p{L}` and `\p{N}`. Already in the graph through `url` → `idna`. Unicode-3.0.       | Lead #157 | 2026-10-13 |

**Packages:**

| Package                                                         | Version                       | Why it earns its place                                                                               | Approver  | Date       |
| --------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- | --------- | ---------- |
| `@hey-api/openapi-ts`                                           | `0.99.0` (api-client dev)     | The local generation of the SDK, the wire types, and the Zod validators.                             | Lead #157 | 2026-10-13 |
| `typescript`                                                    | `6.0.3` (api-client dev only) | The generator's peer: it uses the TypeScript compiler API, which TypeScript 7 does not export (§13). | Lead #157 | 2026-10-13 |
| `zod`                                                           | `4.6.5` (catalog)             | The executed validation of API answers and of the Sony tooling's files.                              | Lead #157 | 2026-10-13 |
| `react`, `react-dom`, `vite`                                    | `19.x`, `19.x`, `8.x`         | The SPA and its build.                                                                               | Owner     | (existing) |
| `@tanstack/react-router`, `@tanstack/react-query` (+ persister) | `1.x`, `5.x`                  | URL state and the query cache.                                                                       | Owner     | (existing) |
| `typescript`                                                    | `7.x` (catalog)               | The language and the type check.                                                                     | Owner     | (existing) |
| `oxlint`, `oxlint-tsgolint`                                     | locked                        | Type-aware lint for TypeScript 7.                                                                    | Owner     | 2026-10-02 |
| `prettier`, `vitest`                                            | `3.x`, `5.x`                  | Format and TypeScript tests.                                                                         | Owner     | (existing) |
| `@playwright/test`, `@axe-core/playwright`                      | `1.63.0`, `4.13.0` (e2e)      | Browser journeys and accessibility checks (`e2e/`).                                                  | Lead #157 | 2026-10-14 |
| `playwright`                                                    | `1.63.0` (bot)                | Captures the Sony GraphQL contract during `sony:refresh`. Never in the runtime image.                | Owner     | (existing) |
| `tailwindcss`                                                   | `4.x`                         | Styling.                                                                                             | Owner     | (existing) |
| `dompurify`                                                     | `3.4.16`                      | Sanitizes Sony-authored description HTML before `dangerouslySetInnerHTML`.                           | pm/team   | 2026-05-31 |
| `luxon` (+ `@types/luxon`)                                      | `3.x` (`3.7.6`)               | Date parse and localized formatting in the views.                                                    | pm/team   | 2026-05-31 |
| `concurrently`                                                  | `10.x`                        | Runs the server and Vite in `mise run dev`.                                                          | Owner     | (existing) |

**Tools** (`mise.toml`):

| Tool          | Version   | Why it earns its place                                                                         | Approver           | Date       |
| ------------- | --------- | ---------------------------------------------------------------------------------------------- | ------------------ | ---------- |
| Gitleaks      | `8.30.1`  | Secret scan (§14). One local binary, no network calls. MIT.                                    | Owner (issue #146) | 2026-10-04 |
| cargo-deny    | `0.20.2`  | Advisories, bans, licences, and sources of the crate graph. Aqua release binary with checksum. | Lead #157          | 2026-10-13 |
| cargo-nextest | `0.9.146` | The Rust test runner. Aqua release binary with checksum.                                       | Lead #157          | 2026-10-13 |
| cargo-shear   | `1.14.0`  | Unused crate dependencies. GitHub release binary with digest and attestation check.            | Lead #157          | 2026-10-13 |

**External service:** IGDB API v4 (`api.igdb.com`, `id.twitch.tv`), server side only (§2.3); approved pm/team 2026-10-03. **Shared versions:** the `catalog:` block of `pnpm-workspace.yaml` is the single version source for a package that more than one manifest declares.

---

## 7. Stack-specific reject-list additions

- First-party unsafe code.
- Production `unwrap`, `expect`, `panic!`, `todo!`, or `unimplemented!` for ordinary failures; `dbg!` anywhere; `println!` or `eprintln!` in shipped server paths.
- Lint suppression without a narrow reason (`#[allow]` is denied; use `#[expect(…, reason = "…")]`); a change to a check only to obtain a pass.
- A bare `String` id across the crate boundary or the API where a newtype exists (`GameId`, `ProductId`, `ConceptId`).
- Deserialization that bypasses domain invariants; an unchecked or lossy wire-to-domain conversion; an invented default for missing data.
- `serde_json::Value` past the source adapter boundary; a reqwest error text in a message, a log, or a response.
- `sort_unstable` where the order of equal items is visible.
- Ambient time, environment, filesystem, network, process, or random access in `crates/domain`.
- Unbounded queues, retries, response bodies, or concurrency; an outbound call without a deadline.
- Blocking I/O or heavy CPU work on the async request path; a synchronous lock guard across `await`; a spawned task without an owner (§9).
- Hand-written status codes for typed failures in handlers; map each error in `crates/server/src/http/errors.rs` (§2.2).
- TypeScript `any` (the `no-explicit-any` and `no-unsafe-*` rules are errors), `as` casts that bypass type checking (use `satisfies` or a Zod guard), or `@ts-ignore`/`@ts-expect-error` without a precise reason; a raw `fetch` or a handwritten wire contract outside `@psstore/api-client`; a manual edit of generated artifacts.
- `console.*` in shipped web code; class-based React components; `useEffect` for server-data fetching.
- Host-local timezone arithmetic or a manual UTC-offset calculation (§10).
- **Writing package or crate code from memory** without the §12 retrieval.
- **A second critic or review provider, a user rating or review, a call to IGDB from the browser, or critic data on the list `Game` type.**
- **A Sony credential or per-user data outside its allowed path** (§2.5). The NPSSO is allowed only in the HttpOnly sign-in cookie and in the body of the sign-in request. Banned: the NPSSO in any cookie that JavaScript can read, in `localStorage`, `sessionStorage`, IndexedDB, a URL, a log, a cache, or a committed file; the access token anywhere it is persisted or returned to the client; a server-side session store; a kept refresh token; and an account identifier or signed-in response data in any cache, storage, log, URL, or committed file.

---

## 8. Logging & privacy

- **Logger:** `tracing` events through the allowlist layer (`crates/server/src/observability.rs`). The layer writes one line per event to standard output: a JSON object (`PSSTORE_LOG_FORMAT=json`, the default and the production format) or a readable text line (`PSSTORE_LOG_FORMAT=text`, set by `mise run dev`). An invalid value falls back to JSON and logs `reason=invalid_log_format`. Both formats keep only the fields in `ALLOWED_FIELDS`, from the event and from its spans; other field values are dropped and only their names are listed. The layer ignores events from other crates, because their text can contain URLs. An event message is a fixed text.
- **Request correlation:** `request_context` runs each request in a `request` span with a random `request_id` (UUID v4, made inside the panic containment), the route pattern, and the method. Every event inside the request carries the id. Lookup tasks that several requests share (the cache, the in-flight exchange) carry no request id. Each request writes one line with the route pattern, the method, the status, and the elapsed time — never the path, the query, a header, or a body, because a search term or a game id is user input.
- **No PII / no telemetry.** No crash reporter and no browser diagnostics: a web failure renders as a UI state and is not reported. A crash or error reporter needs a §6 entry with a data-flow reason. Add a field to `ALLOWED_FIELDS` only when every value is data-free by construction (a tag, a count, a route pattern, an operation name).
- **Language:** everything the user sees is in English: UI chrome, Sony game data, and formatted dates. Request Sony data from the Finnish store (EUR) in English. Region (Finland, EUR) and content language (English) are separate. The content language is a fixed constant (`SONY_LOCALE`, `en-fi`, sent as `en-FI` in the locale override header), never a switcher, a stored choice, or a value derived from the browser. Formatted dates: `en-GB`, passed explicitly to luxon. Prices stay Sony's verbatim strings (decimal comma, no reformatting).
- **Critic score credentials:** the Twitch client secret and the access token are `Secret`. `IgdbCredentials` hides both values in its `Debug` output. Never log the client secret, the token, the `Client-ID` header, the `Authorization` header, or the token request body. A failed lookup logs only its error tag.
- **Sony credentials:** never log the `Cookie` or `Set-Cookie` header, the `Location` header of the Sony authorize redirect, the headers or the body of a sign-in or signed-in request, an account identifier, or signed-in response data. A failed account request logs only its error tag. The panic hook logs only the source position (`panic_location`), never the panic message.

---

## 9. Background & lifecycle

- **Allowed:** TTL-bounded cache refresh driven by request access. The client tab prefetch: once per page load, one request at a time, only while no other fetch is active (§2.5).
- **Owned tasks:** a cache lookup and the shared NPSSO exchange run as spawned tasks that the cache or the `InFlight` map owns. Their deadlines bound them; a drop guard inside the task removes the entry when the task ends, also after a panic when no caller waits; a failure outcome has its own short time to live. The runtime drops them at shutdown.
- **Forbidden:** background polling or long-lived connections without active user interaction; work that retains data that `VISION.md` forbids; background session refresh; background refetch of signed-in data, except the one prefetch per page load.
- **Shutdown** (`crates/server/src/lifecycle.rs`): on SIGTERM or SIGINT the server stops accepting connections and gives active requests 35 seconds (the purchased crawl has a 30-second deadline). After the deadline the loop ends (`DeadlineReached`), the process ends the runtime with `shutdown_background`, and exits with code 0. A signal handler that cannot be set up logs a warning; then only a kill stops the process. `crates/server/tests/lifecycle.rs` tests the idle stop, a request within the deadline, a request past the deadline, and the binary on SIGTERM and SIGINT.

---

## 10. Time & timezones

UTC everywhere internally. Convert only at the boundary (`DOCTRINE.md` P5).

- **Instant:** a Jiff `Timestamp` or epoch milliseconds for computation. On the wire (`Game.date`) an instant is an RFC 3339 UTC string with `Z`, in second or millisecond precision depending on the source (see below), or the empty string when Sony gives no valid date. A missing or unparseable date is never a guessed instant. No value has an implicit local offset.
- **Inbound boundary:** the Sony mapper (`crates/domain/src/mapper.rs`, with the JavaScript date rules in `crates/domain/src/js.rs`) keeps the date forms of the TypeScript server it replaced: NEW and search cards pass Sony's string through (`…T21:00:00Z`); MONTHLY and BROWSE cards normalise with `Date.parse` and `toISOString()` semantics (`….000Z`). The tests pin each date path.
- **Outbound boundary (client):** only the rendering component converts an instant to a local date: luxon `DateTime.fromISO(value)`, then `toLocaleString(DateTime.DATE_MED, { locale: 'en-GB' })`. The result uses the viewer's system timezone.
- **NEW / UPCOMING day split:** the split is at the viewer's next local midnight (`docs/adr/0001-new-upcoming-day-split.md`). The server never receives the viewer's time zone. It sends each list a UTC superset: NEW ends at `now + 37 h`, UPCOMING starts at `now - 12 h`. The rendering component (`Games.tsx`, through `web/src/modules/releaseDay.ts`) computes the next local midnight with luxon and keeps each game in one list.
- **Current instant:** server code reads it through the injected `Clock` (`crates/server/src/application/clock.rs`); a pure function takes it as a parameter. Deadlines, timeouts, and cache expiry use `tokio::time`.
- **Tests:** `FixedClock` and `#[tokio::test(start_paused = true)]`. Do not assert on a string that depends on the timezone of the test machine.
- **Banned:** formatting an instant as a local-time string outside the rendering component; storing or caching a local-time string.
- **Numbers:** query integers must be safe JavaScript integers (at most 2^53 − 1), like the TypeScript server's schema checks. Prices are Sony's strings, never numbers.

---

## 11. Design guidelines & UX thresholds

- **Design authority:** WCAG 2.2 AA and native HTML semantics. Semantic elements first; ARIA only where no native element fits.
- **Thresholds:** text contrast ≥ 4.5:1 for body text and ≥ 3:1 for large text (WCAG 1.4.3); pointer targets ≥ 24×24 CSS px (WCAG 2.5.8); a visible focus indicator on every interactive element (WCAG 2.4.7).
- **Inputs:** full keyboard operation, focus order that follows DOM order, accessible names, and announced validation and error states. No pointer-only interaction.
- **Browser evidence:** Playwright journeys and axe checks (`e2e/`, §14) against the deterministic test server: the real router, middleware, and SPA build over fake ports with synthetic data. Chromium desktop and one narrow mobile viewport. A journey against live Sony is a separate live check, not part of `verify`.
- **Source:** MDN and the W3C WCAG 2.2 pages (§12).

---

## 12. Best practices source

**Hard rule: never write or modify code that uses a package or crate in §6 from memory. Retrieve version-pinned docs first** (the `find-docs` skill or the Context7 MCP; otherwise `npx ctx7@latest library "<name>" "<question>"`, then `npx ctx7@latest docs <libraryId> "<question>"`). For a crate, the pinned source in `~/.cargo/registry/src/index.crates.io-*/<crate>-<version>/` is the authority for the exact version; docs.rs serves the same version. For browser semantics and accessibility, use MDN and the W3C WCAG 2.2 pages. `architect` and `ux-guardian` cite the doc section in each verdict that depends on an API or guideline detail.

1. **Resolve, don't guess.** If a library ID fails to resolve, use Context7's resolver and take the canonical ID it returns.
2. **Pin the version in the query.** Axum 0.8 uses `/{id}` path syntax; reqwest 0.13 puts query and form support behind features; utoipa 6 and utoipa-axum 0.3 go together; Hey API's configuration changes between minor versions.
3. **Targeted queries only.** Ask the question for the task at hand.
4. **Retrieve before integrating.** The riskiest code is the glue between packages (a tower-http service inside an Axum fallback, the generated client inside the facade). Retrieve both sides.

References: the [Rust edition guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html), [Clippy](https://rust-lang.github.io/rust-clippy/master/index.html), [Axum](https://docs.rs/axum/), [Tower HTTP](https://docs.rs/tower-http/), [Tokio shutdown](https://tokio.rs/tokio/topics/shutdown), [Serde](https://serde.rs/), [Jiff](https://docs.rs/jiff/), [utoipa](https://docs.rs/utoipa/), [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457), [Hey API](https://heyapi.dev/), [nextest](https://nexte.st/), [cargo-deny](https://embarkstudios.github.io/cargo-deny/checks/index.html), [Playwright accessibility](https://playwright.dev/docs/accessibility-testing), and [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

---

## 13. Scoped exceptions and intentional divergences

Do not weaken a rule or a check to make a change pass. The responsible lead resolves an exception within project authority, with an independent reviewer. The change author must not approve their own weaker acceptance or checks. Escalate a change beyond that authority, or an unresolved material risk, to the owner. Record a significant decision in a short `docs/adr/` file.

### Scoped exceptions

| Rule / scope                                                                                                                        | Reason and consequences                                                                                                                                                                                                              | Compensating evidence                                                                                                                                                                           | Responsible lead / reviewer / approval                         | Expiry or reassessment                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| §1 `exactOptionalPropertyTypes`, only for `packages/api-client/src/generated/` (`tsconfig.generated.json`)                          | The client runtime that Hey API 0.99.0 copies into `generated/client` and `generated/core` gives 12 errors with this flag. Generated files must not be edited.                                                                       | Every other strict flag stays on for the generated code; the facade, its tests, and `web/` keep the full flag set; `contract:check` keeps the generated tree identical to the generator output. | Lead of issue #157 / independent reviewer of PR #158 (pending) | When a Hey API release passes the flag, or at the next generator upgrade. |
| §1 one TypeScript line: `typescript@6.0.3` as a devDependency of `packages/api-client` only                                         | `@hey-api/openapi-ts` 0.99.0 uses the TypeScript compiler API (`ts.factory`), which the TypeScript 7 package does not export.                                                                                                        | The type check of every package runs TypeScript 7; TypeScript 6 runs only inside the generator.                                                                                                 | Lead of issue #157 / independent reviewer of PR #158 (pending) | When Hey API supports TypeScript 7, or at the next generator upgrade.     |
| §14 dependency scan triage rule 3: the override `'@hey-api/json-schema-ref-parser@1.4.4>js-yaml': '4.3.2'` in `pnpm-workspace.yaml` | The generator's dependency pins js-yaml 4.2.0, which has GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, and GHSA-2883-xcg3-v3hh (high). 4.3.2 fixes them, but it is outside the parent's exact pin. js-yaml runs only at generation time. | `pnpm audit` passes; `contract:check` proves that the generated output is byte-identical with the override.                                                                                     | Lead of issue #157 / independent reviewer of PR #158 (pending) | When the generator depends on a fixed js-yaml; remove the override then.  |

### Intentional divergences

A row with the approval "Owner" is a permanent owner decision with no expiry. A row with the approval "Lead #157" is a delegated technical choice of the port (issue #157); the independent review of PR #158 checks it. Reassess a row when its reason no longer holds.

| Date       | Rule                                                                        | Divergence                                                                                                                                                                                                     | Reason                                                                                                                                                                                                                                                         | Approval  |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 2026-10-02 | Profile §1 Frontend (TypeScript 6, typescript-eslint, ESLint)               | TypeScript 7 with Oxlint and tsgolint.                                                                                                                                                                         | The owner approved Oxlint and tsgolint on 2026-10-02. The profile names this alternative for TypeScript 7. The `tsconfig` flags and the React hook rules of the profile apply.                                                                                 | Owner     |
| 2026-10-13 | Profile §1 (inherit `rust-version` in each crate)                           | `crates/server` repeats `edition`, `rust-version`, and `publish`.                                                                                                                                              | Railpack 0.40.1 cannot decode inherited package fields in the binary crate and then plans a failing build (`crates/server/Cargo.toml`).                                                                                                                        | Lead #157 |
| 2026-10-13 | Profile §3 (mise tasks only)                                                | Thin pnpm aliases (`pnpm dev`, `pnpm test-all`, …).                                                                                                                                                            | `CLAUDE.md` names `pnpm dev` in the owner hand-off. The profile allows such an alias.                                                                                                                                                                          | Lead #157 |
| 2026-10-03 | Profile §2.5 (OIDC and backend sessions)                                    | The Sony NPSSO in an HttpOnly cookie for 30 days; the server sets the sign-in cookie, exchanges the NPSSO on every request, and keeps no session store (§2.5). A 401 from a signed-in route clears the cookie. | Sony offers no OIDC for third parties. Owner decision (issue #108, 2026-10-03): the user signs in once until Sony expires the NPSSO. The cookie is HttpOnly, Secure, and SameSite=Strict, so script cannot read it and a cross-site request does not carry it. | Owner     |
| 2026-10-03 | §9 and §2.5 (previous text: signed-in fetches only on a user action)        | The client fetches WISHLIST and PURCHASED once per page load without a click, in the tab prefetch.                                                                                                             | Owner decision (issue #134, 2026-10-03): the other tabs load fast when the user opens them. Cost: up to 2 token exchanges and up to 21 Sony library calls on each page load of a signed-in user.                                                               | Owner     |
| 2026-10-13 | Profile §4 (a budget table with values)                                     | No budget.                                                                                                                                                                                                     | Owner decision 2026-10-13 (ADR 0003).                                                                                                                                                                                                                          | Owner     |
| 2026-10-13 | Profile §5 (PostgreSQL when durable data is needed)                         | No storage.                                                                                                                                                                                                    | `VISION.md`: no durable data.                                                                                                                                                                                                                                  | Owner     |
| 2026-10-13 | Profile §7 (no bare `String` entity ids)                                    | The raw upstream ids in `Concept`, `ConceptProductRef`, and `CategoryGridProduct` stay `Option<String>`; the narrowed types use `ProductId` and `ConceptId`.                                                   | These fields hold Sony's undecided values before narrowing: an empty product id must hide the concept id, and UPCOMING keeps a non-SKU id as a concept card. A validated type would drop or add items.                                                         | Lead #157 |
| 2026-10-13 | `DOCTRINE.md` P5 and profile §2.2 (an invalid envelope stops the operation) | A drifted category grid of NEW, UPCOMING, or DISCOUNTED gives an empty list with a drift warning, not a 502 (§2.2).                                                                                            | The TypeScript server did the same, and the port keeps its behaviour. A change shows the error state instead of an empty list, which is a product change outside the port (issue #160).                                                                        | Lead #157 |
| 2026-10-13 | Profile §10 (one defined wire precision)                                    | Two precisions on the wire, by card source (§10).                                                                                                                                                              | The values of the TypeScript server stay, so the success-body parity evidence stays valid.                                                                                                                                                                     | Lead #157 |
| 2026-10-02 | Sony contract tooling scope (the runbook: the tooling captures `fi-fi`)     | The server requests `en-fi`. The contract bot, the manifest metadata, and the capture routes stay on `fi-fi`.                                                                                                  | Structural parity verified live on 2026-10-02: same ids, order, counts, PDP, and prices. The persisted-query hashes do not depend on locale. The manifest operation variable schemas contain no locale key.                                                    | Owner     |

---

## 14. Applicability and evidence

Run the required tests and the full `$VERIFY_CMD` locally on the exact version to merge, integrated with the current `main`. A failed or missing required local check blocks merge. The repository has no CI pipeline, and a missing CI pipeline does not block merge. Missing pre-merge evidence blocks merge; missing post-release evidence blocks a claim of a successful release. For a material change, the independent reviewer runs `mise run verify` and the required tests on the PR head integrated with the current base in an isolated checkout and records the head, the base, and the tested tree.

| Doctrine / applicability               | Required evidence                                                                                           | Environment / gap                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P1, P6: each task                      | Criteria, failure cases, assumptions, and their check mapping in the issue or the PR                        | The lead prepares them; a material change gets an independent review.                          |
| P2–P4: types, dependencies, boundaries | `mise run verify`; a §6 entry for each new dependency; crate and import boundaries                          | Manifest edits and ambient effects need review (§0 gaps).                                      |
| P3, P5: the HTTP contract              | `contract:check`; the real-answer conformance test; executed success and error validation in the API client | Annotations do not prove handler behaviour; the conformance test does.                         |
| P5–P6: data meaning                    | Decode and scope tests, golden fixtures, one invalid item among valid ones, whole-response failures         | Golden fixtures hold synthetic data only (§2.5 → Fixtures).                                    |
| P5–P6: upstream contracts              | The live checks below, with their triggers and owners                                                       | Live checks need network access to Sony and IGDB; the signed-in probes need the owner's NPSSO. |
| P3, P7: security                       | Gitleaks, `pnpm audit`, `cargo deny check`, `cargo shear`; the §2.5 rules; the security headers             | Known gap: `sony-npsso` misses some NPSSO forms; the reviewer checks the diff for secrets.     |
| P5–P7: browser                         | Playwright journeys, the degraded and error states, keyboard operation, and axe (§11)                       | Chromium only; Firefox and Safari are not tested.                                              |
| P7: release                            | Before merge: the Railpack plan and the recovery path; after release: §15 release checks                    | The first Linux build of a build change happens on Railway at the merge.                       |
| P8–P9: material changes                | Current docs, an ADR for a significant decision, independent integrated verification, explicit limitations  | Separate reviewer context; exact tested revisions.                                             |

### Check configuration

| Check             | Tool                                                                                      | Acceptance condition                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format            | rustfmt and Prettier, check mode                                                          | No formatting difference                                                                                                                              |
| Types and lint    | Clippy (`-D warnings`), tsc, Oxlint (`--type-aware --deny-warnings`)                      | No errors, no warnings                                                                                                                                |
| Dead dependencies | `cargo shear --locked --deny-warnings`; rustc unused checks                               | No finding                                                                                                                                            |
| Boundaries        | Cargo declarations, the domain `clippy.toml`, Oxlint `no-restricted-globals`              | No forbidden edge; review the §0 gaps                                                                                                                 |
| Contracts         | `contract:check`, the conformance test, the API client tests                              | No drift; no invalid data accepted                                                                                                                    |
| Secrets           | Gitleaks with `--redact` and `--config .gitleaks.toml` on the history that `HEAD` reaches | No finding                                                                                                                                            |
| Rust dependencies | `cargo deny --locked check` (advisories, bans, licences, sources)                         | No finding; `deny.toml` allows permissive licences and crates.io only, treats yanked and unmaintained crates as findings, and denies an unused ignore |
| JS dependencies   | `pnpm audit --audit-level low`                                                            | No advisory of any severity                                                                                                                           |
| Behaviour         | nextest, doctests, Vitest, Playwright with axe                                            | All required cases pass; expected outcomes have independent support                                                                                   |

**Secret scan.** `mise run scan:secrets` runs Gitleaks on the Git history that `HEAD` reaches (`--full-history HEAD`); other local branches do not change the result. It reads commits only, so uncommitted files and the ignored `.env` file are out of scope. `--redact` keeps secret values out of the output (§8). `--config .gitleaks.toml` means that a `GITLEAKS_CONFIG` environment variable cannot replace the rules.

**Secret rules.** `.gitleaks.toml` keeps the Gitleaks default rules and adds `sony-npsso`, because no default rule detects the NPSSO. It matches a name that contains `npsso` in any case, then optional letters, digits, `_`, or `-`, then an optional quote and optional white space, then one separator (`:`, `=`, `(`, or `,`), then a value of exactly 64 characters from the cookie-safe set of §2.5 whose first and last characters are letters or digits. psn-api documents the length; the character set is an assumption. Examples: `npsso=…`, `SONY_NPSSO=…`, `"npsso": "…"`, `let npsso = "…"`, `exchangeNpsso('…')`. Known gaps: a wrapped value such as `Secret::new("…")`, a type annotation such as `let npsso: &str = "…"`, a property path, another operator, a value without an `npsso` name, a value that starts or ends with `.`, `_`, `~`, or `-`, and a value of another length. §2.5 → Fixtures and the reviewer's diff check cover these gaps.

**Dependency scope.** `pnpm audit` covers all resolved npm dependencies (`dependencies`, `devDependencies`, and `optionalDependencies`); `cargo deny` covers the whole crate graph. Development dependencies are in scope because they run on the machine where the owner uses the NPSSO (§0, §2.5).

**Network and time.** `pnpm audit` sends the resolved package names and versions to `registry.npmjs.org`; `cargo deny` fetches the RustSec advisory database from GitHub and reads the crates.io index. A registry or fetch error fails the scan. The advisory data changes over time, so an unchanged commit can fail when a new advisory appears. Record the time of the run in the PR evidence.

Triage a finding with these rules:

1. **Real secret:** treat the secret as leaked. Revoke or rotate it first. For the NPSSO, sign out of Sony (§15). Then remove it from the change. A secret in pushed history stays leaked after its removal. Never put a real secret on an ignore list.
2. **False-positive secret:** on a line in a new commit, add a `gitleaks:allow` comment with the reason. For a commit already on `main`, add the finding fingerprint to `.gitleaksignore` with a comment. A fingerprint names one commit, file, rule, and line, so a later change to that line gives a new finding for a new triage.
3. **Advisory with a fix:** update the affected package to a patched version (`pnpm update -r <package>`, `cargo update -p <crate> --precise <version>`), or, when a direct dependency pins the vulnerable version, update that dependency within its major version or add a narrow override with a §13 row. Keep the lockfile diff to the affected packages.
4. **Advisory without a usable fix:** for npm, add its GHSA id to `audit.ignore` in `pnpm-workspace.yaml`; for a crate, add its RUSTSEC id to `[advisories] ignore` in `deny.toml`, with a comment. Record a scoped exception in §13.

Never pass a scan by `--ignore-registry-errors`, `--ignore-unfixable`, `--prod`, a higher `--audit-level`, a weaker `deny.toml` (a wider licence or source list, a lower advisory level), a Gitleaks allowlist wider than one finding, or a removed or weaker rule in `.gitleaks.toml`. A change to the threshold, the rules, or the scope of a check changes an acceptance gate and needs independent review.

### Live checks

`$VERIFY_CMD` checks the Sony boundary against committed fixtures only. The checks below reach live services. `docs/contracts/sony-graphql-runbook.md` is the reference for each. Never schedule or automate them (§9).

| Check                           | Trigger                                                                                                                                                                                                                                                                               | Who runs it                                                                                                                                                                    | Evidence in the PR                                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise run test-live`            | The diff touches `crates/server/src/sources/sony/**` (except the signed-in client), `crates/server/src/sources/igdb/**`, `crates/domain/src/**`, `crates/server/src/application/games.rs`, `crates/server/src/application/critic_scores.rs`, or `docs/contracts/sony-constants.json`. | The PR author (`lead-dev`), on the pushed head. The SCORE checks need the owner's `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` in the environment; an agent never holds them.     | The per-feature counts (NEW / UPCOMING / DISCOUNTED / MONTHLY / GENRES / BROWSE / SEARCH), the resolved PDP SKU, the SCORE control hit count, and the SCORE hit count of the NEW sample, or `triggered, pending owner run` for SCORE. A PR without them fails review. |
| `mise run sony:refresh`         | No diff trigger. The owner runs it weekly. A persisted-query hash rotation also needs it.                                                                                                                                                                                             | Owner-run. An agent runs it only when the owner asks in the current task or the task is a hash-rotation fix.                                                                   | On drift: the refreshed `docs/contracts/sony-graphql-manifest.json` and the hashes in `docs/contracts/sony-constants.json`.                                                                                                                                           |
| `mise run sony:probe-purchased` | The diff touches the signed-in flow (§2.5), the signed-in Sony client (`crates/server/src/sources/sony/account.rs` and its submodules), or the `SONY_AUTH_*` or `SONY_PURCHASED_*` keys of `docs/contracts/sony-constants.json`.                                                      | Owner-run only. The owner supplies a real NPSSO in `SONY_NPSSO`, never committed. An agent never runs it.                                                                      | `triggered, pending owner run`, or `ran on <SHA>: PASS`. On PASS the manifest records `observed_status_codes: [200]` for `purchased`.                                                                                                                                 |
| `mise run sony:probe-wishlist`  | The diff touches the signed-in flow (§2.5), the signed-in Sony client, or the `SONY_AUTH_*` or `SONY_WISHLIST_*` keys of `docs/contracts/sony-constants.json`.                                                                                                                        | Owner-run only. The owner supplies a real NPSSO in `SONY_NPSSO`, never committed. An agent never runs it.                                                                      | `triggered, pending owner run`, or `ran on <SHA>: PASS`. On PASS the manifest records `observed_status_codes: [200]` for `wishlist`.                                                                                                                                  |
| API parity                      | A change that can alter `/api` responses: a server change outside tests and docs.                                                                                                                                                                                                     | The PR author: `cargo run --locked --example api_parity -- <base A> <base B>` between the branch server and production (`https://psstore.calmdonut.com`), or two local builds. | The summary and every explained difference. A difference that the change does not intend fails review. Search answers are nondeterministic upstream; the tool retries a differing pair (`--repeat`).                                                                  |

A live check asserts on a stable control sample; when Sony or IGDB can legitimately lack data for recent items, the hit rate of such a sample is a measurement, not a pass condition (the SCORE NEW sample). Signed-in live checks need a real NPSSO and are owner-run; agents never hold a real NPSSO or access token.

---

## 15. Release, recovery, and maintenance

- **Release:** the Railway service `psstore` (project `calmdonut`, environment `production`) deploys each merge to `main`. A merge is a release. Users reach the site at `https://psstore.calmdonut.com`. Railpack builds the image from `railpack.json`: the Rust provider; Node 24.21.0 and pnpm 12.8.1 from mise for the web build; `cargo build --release --locked --package psstore-server`; and a final image with only `bin/psstore-server` and `web/build` on the Railpack runtime image. The generated contract artifacts are committed, so the image build does not run the export or the generator. The start command is `./bin/psstore-server`. The server binds `0.0.0.0:$PORT`. Every build and start setting is in the repository, so a revert restores the previous build. The Railway service settings (the healthcheck path `/healthz`, the custom domain, and the variables `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`) are not in the repository; record any change to them in the PR.
- **Runtime variables:** `PORT` (Railway), `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` (optional; both or the critic score is off), `RAILWAY_GIT_COMMIT_SHA` (Railway injects it; `/version` reports it), and `PSSTORE_LOG_FORMAT` (`json` by default).
- **Build-time variables:** Railway gives every service variable to every build command, and `"secrets": []` in `railpack.json` limits only the cache scope. A dependency's build script can read the IGDB credentials during the build. The NPSSO is never a service variable. Compensating controls: the lockfiles with `--locked` and `--frozen-lockfile`, `cargo deny`, `pnpm audit`, `cargo shear`, and the `allowBuilds` list in `pnpm-workspace.yaml`.
- **Builder:** the service does not set `RAILPACK_VERSION`. The plan evidence (`railpack info --show-plan .`) comes from Railpack 0.40.1, which prints the warning that its config format is not final. Railpack 0.40.1 cannot decode inherited package fields in the binary crate (§13). After a Railpack change or a manifest change, compare the plan again.
- **Asset routing and headers:** `/assets/…` serves the hashed bundles (a missing file is 404); other files are served with `Cache-Control: no-cache`; a deep link without a file extension and with `text/html` in `Accept` gets `index.html`; every `/api` path that no route serves is a Problem Details 404. Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and `Cross-Origin-Opener-Policy: same-origin`.
- **Observe:** `/healthz` (liveness), `/readyz` (ready when the configuration is valid and the listener is bound; it calls neither Sony nor IGDB, because their failures are per-request upstream errors), and `/version` (`{"version", "commit"}`). The structured server log in Railway (§8) and Railway's metrics.
- **Release checks:** after a merge, confirm with the Railway deployment list that the merge commit has status SUCCESS and that `/version` reports the merge commit. Then run public GET checks: `/healthz`, `/readyz`, `/api/games/new`, `/api/games/upcoming`, one `/api/games/<id>`, an `assets/index-*.js` bundle, one SPA route with `Accept: text/html`, and the security headers on one answer. Send `POST /api/session` with a made-up NPSSO of the valid format (never a real one) and expect the 401 `session_rejected` problem, not 502: this proves that the deployed build reaches Sony's sign-in server. Read Railway's memory metric for the release record.
- **Recover:** a failed build or a failed healthcheck keeps the previous deployment live. For a defect after a successful deployment, roll back to the previous deployment in Railway (the image is kept), then revert the merge commit on a feature branch and merge the revert, so `main` matches production. The server keeps no durable data, so no migration or restore applies. A leaked NPSSO cannot be recovered by a revert: the owner signs out of Sony to invalidate it.
- **Compatibility:** the server and the SPA deploy together. An open tab keeps its bundle until it reloads; the API answers stay compatible within one release, and `index.html` is `no-cache`.
- **Maintenance:** review toolchain and dependency upgrades with the same evidence rules. A utoipa or Hey API upgrade needs `contract:check` and the conformance test, not a simultaneous upgrade of both. Recheck the §13 exceptions at each generator upgrade.
- **Data:** the server keeps only the in-memory `TtlCache`. The client persists only the anonymous `games` and `game` queries. The browser keeps the HttpOnly `npsso` cookie for 30 days at most.
