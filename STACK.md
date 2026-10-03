# STACK.md — TypeScript + Effect profile

> Effect-backed TypeScript: an `effect/http-api` HttpApi backend (typed REST + generated OpenAPI) plus a React + Vite SPA, in a pnpm monorepo sharing Effect Schema across server ↔ client. Effect is the backbone because correctness must be machine-checkable: typed errors and Layer-provided dependencies maximise what the compiler proves. **Normative** — MUST / MUST NOT are binding; surface conflicts before deviating.

---

## 0. Project shape

- **Shape:** backend service (typed REST via `effect/http-api` HttpApi) + React SPA frontend.
- **Critical execution path:** the per-request hot path on the server; the browser main thread / React render path on the web.
- **Applicable states:** web surfaces handle awaiting-first-data, success, empty, degraded, offline, error; a surface that needs the Sony sign-in (WISHLIST, PURCHASED) also handles signed-out. API responses are typed success / typed error (the Effect error channel maps to HTTP status). The server stores no per-user state. The browser keeps only the HttpOnly sign-in cookie (§14).

## Scope boundary

Product scope (from `VISION.md`) is enforced **structurally at the Schema layer, not in the UI**: external data is filtered and narrowed during decode, before it reaches any other code. Anything outside scope is dropped at the boundary. Signed-in data follows the same rule (for example, the purchased list and the wishlist hold PS5 games only). No user preferences, no server-side per-user state, no telemetry. Per-user data comes only from the Sony sign-in; §14 fixes its mechanics. If a change cannot fit the scope, surface it rather than expanding it.

---

## External sources outside the GraphQL contract

The MONTHLY view reads one other anonymous host: `https://www.playstation.com/bin/imagic/gameslist` with `locale=en-fi` and `categoryList=plus-monthly-games-list`. It returns public JSON. Its response sets a country cookie. The server never stores, forwards, or sends cookies or credentials to it. The Sony contract tooling does not capture this feed. The drift guard is the golden fixture `server/src/__tests__/fixtures/plusMonthly.golden.json` plus the MONTHLY count in `pnpm test:live`. Decode and scope it at the boundary like any other external data (`plusMonthlySchema.ts`).

---

## 1. Language & Runtime

- **Primary language:** TypeScript 7.x (strict, native compiler).
- **Strictness mode (non-negotiable `tsconfig`):** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`.
- **Target runtime:** Node.js 24 LTS, pinned to 24.21.0 for development.
- **Minimum runtime version:** Node 24.21.0 (no back-deployment).
- **Package manager:** pnpm 12.8.1 (workspaces). **Lockfile:** `pnpm-lock.yaml`.
- **Toolchain bootstrap:** `mise install` provisions Node and pnpm from `mise.toml`, the source of truth. Change the mirrors in the same commit: `.nvmrc` and `engines.node` (the floor) in the root `package.json` for Node, and `packageManager` in the root `package.json` for pnpm. `pmOnFail: error` in `pnpm-workspace.yaml` fails a pnpm version mismatch. Keep `mise.toml` to `[tools]` only.

---

## 2. Frameworks

| Concern             | Technology                                                    | Role                                                                                      |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Backend core        | Effect v4                                                     | Side effects as values; typed errors (`Effect<A, E, R>`); DI via `Layer`                  |
| Schema / validation | Effect Schema (`effect/Schema`)                               | Decode + narrow external data at the boundary (hand-written, single API → no codegen)     |
| REST layer          | `effect/http-api` HttpApi                                     | End-to-end typed routes + generated OpenAPI; thin handlers                                |
| Server cache        | Effect `Cache`                                                | In-memory, built-in TTL, deterministically testable with `TestClock`                      |
| Frontend UI         | React 19 + Vite                                               | Foundation; function components only                                                      |
| Routing             | TanStack Router (SPA); TanStack Start only if SSR is required | Type-safe routing                                                                         |
| Client cache        | TanStack Query                                                | TTL, background refetch, persisted to `localStorage`/IndexedDB via the official persister |
| Styling             | Tailwind CSS v4                                               | Utilitarian; no decorative chrome                                                         |
| Tests               | Vitest                                                        | Pure functions + Effect test `Layer`s                                                     |
| Lint                | Oxlint + tsgolint (type-aware)                                | `no-explicit-any` + `no-unsafe-*` as CI gates                                             |

### Effect conventions (binding)

- **Functional core, imperative shell.** Pure functions compute; I/O lives at the edge. The core MUST NOT import I/O modules (fetch, cache, clock) directly — they are provided as Effect services / `Layer`s and declared in `R`.
- **Errors are values.** No `throw` in domain logic. Failures are modelled in the Effect error channel as **tagged errors**, so the compiler forces every failure path to be handled.
- **The compiler is the reviewer.** Prefer designs where a mistake is a compile error over designs that rely on discipline or runtime checks — this is the primary safety mechanism, as there is no downstream human code review.
- **External data is untrusted until decoded.** Decode and narrow with Effect Schema at the boundary before the data touches any other code.
- Handlers are thin: take decoded input, call the pure core, let the typed error channel map to HTTP status. No hand-rolled error-to-response glue.

---

## 3. Best practices source (Context7 documentation protocol)

**Hard rule: never write or modify code that uses a package in §7 from memory. Retrieve version-pinned docs via Context7 first** (the `find-docs` skill or the Context7 MCP).

**Tools.** Use the Context7 MCP tools when the session or the agent has them. Otherwise use the `ctx7` CLI through Bash: `npx ctx7@latest library "<name>" "<question>"`, then `npx ctx7@latest docs <libraryId> "<question>"`. For browser semantics and accessibility (§13), use MDN and the W3C WCAG 2.2 pages through WebFetch. `architect` and `ux-guardian` cite the doc section in each verdict that depends on an API or guideline detail.

1. **Resolve, don't guess.** If a Context7 ID in §7 fails to resolve, use Context7's library-id resolver and take the canonical ID it returns. Never invent an API without resolved docs backing it.
2. **Pin the version in the query.** Especially Effect: always target the v4 docs — model priors drift toward v3 and v4-beta, but the retrieved v4 docs are the source of truth, not memory. For Effect, the Context7 IDs are `/effect-ts/effect` (the `effect_4.0.0-rc.112` version) and `/websites/effect_website_v4`. Context7 has no 4.0.0 corpus. It still shows the `effect/unstable/*` import paths of the release candidates. For import paths and signatures, the pinned source is the installed package: `node_modules/effect/ai-docs/**` and the `.d.ts` files of `effect` 4.0.0.
3. **Targeted queries only.** Ask the question for the task at hand; do not retrieve whole documents speculatively (the Effect entry is large).
4. **Retrieve before integrating, not just before calling.** The riskiest code is the glue _between_ packages (e.g. wiring a service into an HttpApi handler). When per-package docs don't cover a seam, retrieve both sides and prefer the cohesive Effect-native path over hand-rolled glue.

---

## 4. Build & verify commands

| Variable      | Command                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `$FORMAT_CMD` | `pnpm format`                                                                                              |
| `$LINT_CMD`   | `pnpm lint` (Oxlint, type-aware; the gates below fail the build, not warn)                                 |
| `$BUILD_CMD`  | `pnpm build`                                                                                               |
| `$TEST_CMD`   | `pnpm test` (Vitest)                                                                                       |
| `$VERIFY_CMD` | `pnpm test-all` (format check → type-check → lint → build → tests → `sony:validate` → `sony:diff -- --ci`) |

The `package.json` scripts are the single source of truth. Never invoke `tsc`, `oxlint`, `vitest`, or `vite` directly from commits, CI, or agent scripts.

**Narrow test selector** (for the mutation check): `pnpm --filter <workspace package> test <test file>`, for example `pnpm --filter @psstore/server test src/__tests__/mapper.test.ts`. The path is relative to the workspace package.

### Other checks

`$VERIFY_CMD` checks the Sony boundary against committed fixtures only. It does not reach live Sony. The checks below do. `docs/contracts/sony-graphql-runbook.md` is the reference for each.

| Check                       | Trigger                                                                                                                                                 | Who runs it                                                                                                  | Evidence in the PR                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:live`            | The diff touches `server/src/sony/**` or `server/src/domain/listing.ts`.                                                                                | The PR author (`lead-dev`), on the pushed head.                                                              | The per-feature counts (NEW / UPCOMING / DISCOUNTED / MONTHLY / SEARCH) and the resolved PDP SKU. A PR without them fails review.     |
| `pnpm sony:refresh`         | No diff trigger. The owner runs it weekly. A persisted-query hash rotation also needs it (runbook → Failure handling).                                  | Owner-run. An agent runs it only when the owner asks in the current task or the task is a hash-rotation fix. | On drift: the refreshed `docs/contracts/sony-graphql-manifest.json` and the hash constants in `server/src/config/env.ts`.             |
| `pnpm sony:probe-purchased` | The diff touches the signed-in flow (§14), the signed-in calls in `server/src/sony/sonyClient.ts`, or `SONY_PURCHASED_*` in `server/src/config/env.ts`. | Owner-run only. The owner supplies a real NPSSO in `SONY_NPSSO`, never committed. An agent never runs it.    | `triggered, pending owner run`, or `ran on <SHA>: PASS`. On PASS the manifest records `observed_status_codes: [200]` for `purchased`. |
| `pnpm sony:probe-wishlist`  | The diff touches the signed-in flow (§14), the signed-in calls in `server/src/sony/sonyClient.ts`, or `SONY_WISHLIST_*` in `server/src/config/env.ts`.  | Owner-run only. The owner supplies a real NPSSO in `SONY_NPSSO`, never committed. An agent never runs it.    | `triggered, pending owner run`, or `ran on <SHA>: PASS`. On PASS the manifest records `observed_status_codes: [200]` for `wishlist`.  |

Never schedule or automate any of these checks (§10).

**Signed-in Sony flow.** A live check or a contract capture of the sign-in exchange or of a signed-in Sony operation needs a real NPSSO. Both are owner-run: the owner supplies their own NPSSO through an environment variable that is never committed. Agents never hold a real NPSSO or access token. When a diff touches the signed-in flow, list the live check in the PR as `triggered, pending owner run`, or `ran on <SHA>: PASS`.

---

## 5. Performance budgets

TBD. Let's aim for fast.

---

## 6. Persistence shape

- **Server:** in-memory Effect `Cache` only — TTL built in, no manual invalidation. **No database, no on-disk persistence, no per-visitor state.** Purchased-games requests and the sign-in exchange bypass the cache (§14).
- **Client:** TanStack Query cache persisted to `localStorage`/IndexedDB via the official persister, for anonymous store queries only. Signed-in responses live in memory only. **No per-user value is persisted by script.** The one per-user value the browser keeps is the HttpOnly NPSSO cookie (§14), which JavaScript cannot read.
- **Persisted entities:** declared by `VISION.md → Persistence and Privacy Posture`.
- **Forbidden persistence:** accounts, user preferences, per-user state, telemetry, and anything forbidden in `VISION.md → Persistence and Privacy Posture`.

---

## 7. Approved dependencies

Default answer to "should we add a library?" is **no**. Track the latest **stable** version; pin exact versions in the lockfile; upgrade deliberately, not by drift. **Effect is on v4** (4.0.0). The HTTP, HttpApi, and static-file modules ship inside `effect` as `effect/http` (including `HttpStaticServer`) and `effect/http-api`, and Effect marks them `@stability unstable`. The owner accepted them for the REST layer (§15). Pin the Effect family by hand to exact versions. Never use `pnpm update --latest`, `-L`, or `@latest` on the Effect family. Do not install the `redis` peer of `@effect/platform-node`: `pnpm-workspace.yaml` marks it optional with `packageExtensions`. Import `@effect/platform-node` by subpath (for example `@effect/platform-node/NodeHttpServer`). Its package root re-exports a Redis module and fails to load without `redis`.

| Dependency                          | Version                                   | Context7 ID                                        | Why it earns its place                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect` (+ Schema, Cache, HttpApi) | `4.0.0`                                   | `/effect-ts/effect`, `/websites/effect_website_v4` | Backbone: typed effects, errors, DI; also the HTTP and HttpApi modules (`effect/http`, `effect/http-api`)                                                                                        |
| `@effect/platform-node`             | `4.0.0`                                   | `/effect-ts/effect`                                | Node HttpServer and runtime adapter for HttpApi. Pinned exact to the same version as `effect`. Import by subpath; do not install the `redis` peer.                                               |
| `typescript`                        | `7.x`                                     | `/microsoft/typescript`                            | Language                                                                                                                                                                                         |
| `react`                             | `19.x`                                    | `/facebook/react`                                  | Frontend UI                                                                                                                                                                                      |
| `vite`                              | latest                                    | `/vitejs/vite`                                     | Frontend build tool                                                                                                                                                                              |
| `@tanstack/react-router` (+ Start)  | `1.x`                                     | `/tanstack/router`                                 | Type-safe routing                                                                                                                                                                                |
| `@tanstack/react-query`             | `5.x`                                     | `/tanstack/query`                                  | Client cache                                                                                                                                                                                     |
| `tailwindcss`                       | `4.x`                                     | `/tailwindlabs/tailwindcss`                        | Utilitarian styling                                                                                                                                                                              |
| `vitest`                            | latest                                    | `/vitest-dev/vitest`                               | Test runner                                                                                                                                                                                      |
| `oxlint`                            | latest                                    | `/oxc-project/oxc`                                 | Linter. Reads `.oxlintrc.json`. Approved user 2026-10-02.                                                                                                                                        |
| `oxlint-tsgolint`                   | latest                                    | `/oxc-project/tsgolint`                            | Type-aware lint rules. Bundles its own typescript-go, so the lint does not depend on the `typescript` package version. Approved user 2026-10-02.                                                 |
| `pnpm`                              | `12.8.1` (`mise.toml` + `packageManager`) | `/pnpm/pnpm`                                       | Package manager (runtime: Node 24 LTS, `/nodejs/node`)                                                                                                                                           |
| `dompurify`                         | `3.4.16`                                  | `/cure53/dompurify`                                | Client XSS control: sanitizes Sony-authored description HTML before `dangerouslySetInnerHTML` (`GameDetailsPage.tsx`). No platform equivalent. Approved pm/team 2026-05-31.                      |
| `luxon`                             | `3.7.2`                                   | `/moment/luxon`                                    | Client ISO date parse + localized formatting (`GameCard.tsx`, `GameDetailsPage.tsx`). Kept; an `Intl.DateTimeFormat` swap is a deferred follow-up, not this change. Approved pm/team 2026-05-31. |
| `@types/luxon`                      | `3.7.6`                                   | `/moment/luxon`                                    | Type definitions for `luxon`. Client devDependency only (de-duplicated from the root in this change). Approved pm/team 2026-05-31.                                                               |

New entries require a `STACK.md` PR with rationale, approver, and date.

**Shared versions.** The `catalog:` block in `pnpm-workspace.yaml` is the single version source for any dependency that more than one workspace manifest declares. Manifests reference it with the `catalog:` specifier. Pins stay exact where this table pins them exactly.

**Lint tooling.** `.oxlintrc.json` is the single lint config. It replaces `eslint.config.js`. Oxlint does not support `ignores` inside `overrides`. The Effect HTTP import restriction therefore applies to `server/src/**/*.ts`, and a later override turns it off for the exempt files.

**Tooling (not product runtime deps):** `playwright@1.63.0` is a devDependency of the Sony contract bot (`tools/sony-contract-bot`) used to capture the GraphQL contract during `pnpm sony:refresh`. It never ships in the server or client runtime and is intentionally excluded from the product-dependency table above.
mise is the toolchain bootstrap (§1), not a package dependency. Approved user/pm 2026-10-02.

---

## 8. Stack-specific reject-list additions

- **`any`** — explicit or implicit. `no-explicit-any` and `no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-member-access` are **CI gates (build fails, not warns)**.
- **`throw` in domain logic** — model failures in the Effect error channel as tagged errors.
- **I/O imported directly into the pure core** (fetch, cache, clock) — provide them as Effect services / `Layer`s.
- **Untyped external data** reaching code before it is decoded and narrowed with Effect Schema.
- **`as` casts** that bypass type checking — use `satisfies` or a runtime/Schema guard.
- **`// @ts-ignore` / `// @ts-expect-error`** without an inline reason naming the underlying constraint.
- **`console.*` in shipped code** — use the structured logger (§9).
- **Class-based React components**; **`useEffect` for data fetching** — use TanStack Query.
- **Hand-rolled error-to-response glue** in HttpApi handlers — let the typed error channel map to status.
- **Effect v3 APIs** (for example `Context.Tag`, `Either`, `Schema.optionalWith`, `@effect/platform`) and **`@stability unstable` Effect modules** other than `effect/http` and `effect/http-api`. Both need an intentional migration and a §15 row.
- **Writing package code from memory** without the §3 Context7 retrieval.
- **Local-time instants or hand-rolled UTC-offset arithmetic**, and new ambient `Date.now()` / `new Date()` reads in domain code — see §12.
- **A Sony credential or per-user data outside its allowed path** — see §14. The NPSSO is allowed only in the HttpOnly sign-in cookie and in the body of the sign-in request. Still banned: the NPSSO in any cookie that JavaScript can read, in `localStorage`, `sessionStorage`, IndexedDB, a URL, a log, a cache, or a committed file; the access token anywhere it is persisted or returned to the client; a server-side session store; a kept refresh token; and an account identifier or signed-in response data in any cache, storage, log, URL, or committed file.

---

## 9. Logging & privacy

- **Logger:** Effect's logging (`Effect.log*`) on the server, structured; never `console.*` in shipped code.
- **No PII / no telemetry.**
- **Language:** everything the user sees is in English: UI chrome (labels, placeholders, error states), Sony game data, and formatted dates. Request Sony data from the Finnish store (EUR) in English. The content language is a fixed constant (`SONY_LOCALE`, `en-fi`), never a switcher, a stored choice, or a value derived from the browser. Region (Finland, EUR) and content language (English) are separate. Sony request tag: `en-fi` (sent as `en-FI` in the locale override header). Formatted dates: `en-GB`, passed explicitly to luxon. Prices stay Sony's verbatim strings (decimal comma, no reformatting).
- **Sony credentials:** the server types the NPSSO and the access token as `Redacted` (§14), so a log line prints `<redacted>`. The cookie value is the NPSSO: never log the `Cookie` header or the `Set-Cookie` header, the `Location` header of the Sony authorize redirect, the headers or the body of a sign-in or signed-in request, an account identifier, or signed-in response data. A failed account request logs only its error tag.
- **Crash / error reporter:** none by default; if added, declare it in §7 with data-flow justification.

---

## 10. Background & lifecycle

- **Allowed:** TTL-bounded cache refresh driven by request access (Effect `Cache`).
- **Forbidden:** background polling or long-lived connections without active user interaction; any background work that retains data forbidden by `VISION.md`; background session refresh or background refetch of signed-in data. The client refetches the signed-in list only on a user action.

---

## 11. Definition-of-done additions

On top of `CLAUDE.md → Definition of done`, this stack also requires: `tsc` zero errors; Oxlint zero errors and zero warnings (the §8 `no-any` / `no-unsafe-*` gates); no I/O imported into the pure core; no `throw` in domain logic; any new package usage grounded in §3 Context7-retrieved, version-pinned docs; and no NPSSO outside the HttpOnly cookie and the sign-in request body, and no access token or signed-in data in a log, cache, persisted storage, or committed file (§14). The compiler and this checklist are the review — design code so the checklist _can_ catch mistakes.

---

## 12. Time & timezones

UTC everywhere internally. Convert only at the boundary (`CLAUDE.md → Time`). This section pins the mechanics.

- **Internal representation:** an instant is a UTC ISO-8601 string with a `Z` suffix (for example `Game.date`), or epoch milliseconds for a comparison. A value with an implicit local offset is forbidden. A missing or unparseable upstream date maps to the empty string, never to a guessed instant.
- **Inbound boundary (server):** the Sony mapper (`server/src/sony/mapper.ts`) normalises each upstream date to UTC: `Date.parse`, then `new Date(ms).toISOString()`.
- **Wire:** the API contract carries the UTC string unchanged.
- **Outbound boundary (client):** only the rendering component converts an instant to a local date: luxon `DateTime.fromISO(value)`, then `toLocaleString(DateTime.DATE_MED)` with the explicit locale `en-GB` (§9): `toLocaleString(DateTime.DATE_MED, { locale: 'en-GB' })`. The result uses the viewer's system timezone.
- **Current instant:** new server code reads it through Effect `Clock` (`Clock.currentTimeMillis`, `DateTime.now`). A new pure function takes it as a parameter. Do not add new `Date.now()` / `new Date()` reads to domain code.
- **Tests:** drive new time-dependent server logic with `TestClock` (`TestClock.adjust` / `TestClock.setTime`) or a fixed instant. Do not assert on a string that depends on the timezone of the test machine.
- **Banned:** hand-rolled UTC-offset arithmetic; formatting an instant as a local-time string outside the rendering component; storing or caching a local-time string.

---

## 13. Design guidelines & UX thresholds

- **Design authority:** WCAG 2.2 AA and native HTML semantics. Use semantic elements first. Use ARIA only when no native element fits.
- **Documented thresholds to exercise at the threshold:**
  - Pointer target size ≥ 24×24 CSS px (WCAG 2.5.8).
  - Text contrast ≥ 4.5:1 for body text and ≥ 3:1 for large text (WCAG 1.4.3).
  - A visible focus indicator on every interactive element (WCAG 2.4.7).
- **Input paths:** full keyboard operation. Focus order follows DOM order. No pointer-only interactions.
- **Source:** MDN and the W3C WCAG 2.2 pages (§3).

---

## 14. Sony sign-in & per-user data

`VISION.md → Persistence and Privacy Posture` sets the policy. This section fixes the mechanics for every feature that uses the user's Sony sign-in. WISHLIST and PURCHASED use it. Both are read-only.

- **Credential:** the user pastes their NPSSO token into the sign-in form. Sony offers no public OAuth for third parties. The NPSSO flow is unofficial and undocumented. Treat the NPSSO as a full account credential. The reference for the exchange and for signed-in operations such as the purchased-games list is the `psn-api` documentation (Context7 `/achievements-app/psn-api`). Adding `psn-api` itself as a dependency needs a §7 entry like any other package.
- **Exchange:** the client sends the NPSSO once, in a JSON request body, to `POST /api/session`. The route requires a JSON content type and sends no CORS headers. The backend exchanges the NPSSO with Sony for a short-lived access token. It discards the access token at once. It keeps no refresh token and no id token: the schema reads only `access_token` and `expires_in`. The response is an empty 204 with no token and no NPSSO in the body. The backend sets the sign-in cookie only after Sony accepted the NPSSO.
- **Cookie:** the cookie is named `npsso`. Its value is the NPSSO. Its attributes are `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000` (30 days). `DELETE /api/session` clears it with the same attributes and `Max-Age=0`. JavaScript cannot read it. The server never forwards, stores, or reads back a Sony `Set-Cookie`. The NPSSO payload is 16 to 512 characters from the cookie-safe set `A-Za-z0-9._~-`. `Secure` cookies work on `http://localhost` in Chrome and Firefox, not in Safari.
- **Client:** the client holds no token and no sign-in state of its own. The signed-in status derives from the `['purchased']` and `['wishlist']` queries: a 401 on either one shows the sign-in form. A sign-in or sign-out resets the query that is not on screen, so it makes no hidden Sony call. The browser attaches the cookie. The client never reads `document.cookie` and never writes the NPSSO to `localStorage`, `sessionStorage`, IndexedDB, a URL, or a query key. The input field is cleared on submit. Both queries refetch only on a user action (§10).
- **Requests:** the browser sends the cookie to `/api` routes. A signed-in route reads it through a cookie security middleware (`HttpApiSecurity.apiKey`, key `npsso`). A missing or empty cookie is a 401 with no Sony call. The backend exchanges the NPSSO for a new access token on each request, forwards the token to Sony, and returns the decoded result. Concurrent requests with the same NPSSO share one in-flight exchange (`RcMap`, keyed by the `Redacted` value, no idle time-to-live). The shared entry ends when its last caller has the token, before the library crawl. No access token is kept after that. There is no server session store.
- **Server types:** decode the NPSSO payload with `Schema.RedactedFromValue(Schema.String)`. Decode the Sony access token the same way. `Schema.Redacted` expects an input that is already a `Redacted` value, so it does not fit a JSON string. Read the raw value with `Redacted.value` only at the Sony client calls and in the empty-cookie check of the middleware.
- **Caching:** the sign-in exchange and the signed-in routes never use the Effect `Cache`, and no access token is retained between requests. Only the in-flight sharing in Requests is allowed. On the client, the persister allow-list (`shouldDehydrateQuery` in `client/src/modules/persistence.ts`) admits only the anonymous `games` and `game` keys. Never add a signed-in query to the allow-list. Reset the `['purchased']` and `['wishlist']` queries on sign-out. The game page reads these two lists on a 404 only, to show an entry that the public store has no page for. The reset clears the data. Only the open view refetches, and that request gets a 401 with no Sony call.
- **Scope:** decode signed-in responses with Effect Schema and narrow them to the product scope at the boundary, like anonymous data. The purchased list keeps only an entry with platform exactly `PS5`, a non-empty name, and a valid product id. Everything else is dropped. The library crawl reads pages of 100 in sequence. A library of more than 20 pages fails the request with 502 or 503. It is never cut short. The wishlist is one request with no paging. It keeps an entry only when its platforms include `PS5`, its name is not empty, and its id is valid for its `__typename` (a product id for `Product`, a concept id for `Concept`). The wishlist response has no region field, so its price strings are ignored. The server fills each product entry from the anonymous Finnish store lookup that the game page uses (bounded concurrency, a deadline per entry and one for the list). A concept entry, a missing game, or a slow or failed lookup keeps a card with name and image only. The wishlist itself is never cached; only the public per-game lookups are. A `null` or missing list without a definitive access-denied answer is drift (502). It is never an empty wishlist.
- **Errors:** only a definitive Sony rejection maps to HTTP 401 and clears the cookie. That is an authorize redirect without a code, or a 401 or 403 from the token or library call. A 429 maps to 503. A 5xx, an unexpected answer, or a timeout maps to 502 or 503 and keeps the cookie. The client shows the sign-in form on a 401 only.
- **Contract:** the sign-in exchange and each signed-in operation go through the Sony contract tooling like the anonymous operations. Capture and live checks need a real NPSSO, so the owner runs them (§4 → Other checks). `getPurchasedGameList` and `storeRetrieveWishlist` each have a hand-written synthetic manifest entry. An entry guards the repository-internal name and hash only. It does not detect Sony drift until the owner runs a live check. The server never calls a wishlist write operation.
- **Fixtures:** committed manifests, golden fixtures, and samples never contain a real NPSSO, access token, refresh token, account identifier, or real signed-in response data. Use synthetic values.
- **XSS:** an XSS bug can no longer read the NPSSO cookie, but it can still make requests as the user. Keep DOMPurify on every Sony-authored HTML string. Add no new `dangerouslySetInnerHTML`.

---

## 15. Intentional Divergences

| Date       | CLAUDE.md rule                                                                 | Divergence                                                                                                                                                                                                                                                           | Reason                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | §2, §7, §8 (Effect and its HTTP layer)                                         | `effect/http` (including `HttpStaticServer`, which serves the built SPA) and `effect/http-api` are accepted for the REST layer although Effect marks them `@stability unstable`.                                                                                     | Owner decision: Effect v4 is the current line and the Effect team plans long-term support for it. The exact `effect` pin limits drift of the unstable API. The owner approved it in chat and on issue #94.              |
| 2026-10-02 | Sony contract tooling scope (readme and runbook: the tooling captures `fi-fi`) | The server requests `en-fi`. The contract bot, the manifest metadata, and the capture routes stay on `fi-fi`.                                                                                                                                                        | Structural parity verified live on 2026-10-02: same ids, order, counts, PDP, and prices. The persisted-query hashes do not depend on locale. The manifest operation variable schemas contain no locale key.             |
| 2026-10-03 | `CLAUDE.md` → Privacy & security; `STACK.md` §14 and §8 (previous text)        | The NPSSO persists in an HttpOnly cookie for 30 days, and the server sets a sign-in cookie. The previous §14 forbade both. The server stays stateless and exchanges the NPSSO on every request. A 401 expires the cookie in the middleware as a pre-response header. | Owner decision (issue #108, 2026-10-03): the user signs in once until Sony expires the NPSSO. The cookie is HttpOnly, Secure, and SameSite=Strict, so script cannot read it and a cross-site request does not carry it. |
