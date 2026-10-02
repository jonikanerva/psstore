# STACK.md — TypeScript + Effect profile

> Effect-backed TypeScript: a `@effect/platform` HttpApi backend (typed REST + generated OpenAPI) plus a React + Vite SPA, in a pnpm monorepo sharing Effect Schema across server ↔ client. Effect is the backbone because correctness must be machine-checkable: typed errors and Layer-provided dependencies maximise what the compiler proves. **Normative** — MUST / MUST NOT are binding; surface conflicts before deviating.

---

## 0. Project shape

- **Shape:** backend service (typed REST via `@effect/platform` HttpApi) + React SPA frontend.
- **Critical execution path:** the per-request hot path on the server; the browser main thread / React render path on the web.
- **Applicable states:** web surfaces handle awaiting-first-data, success, empty, degraded, offline, error; a surface that needs the Sony sign-in also handles signed-out and session-expired. API responses are typed success / typed error (the Effect error channel maps to HTTP status). No stored per-user state (§14).

## Scope boundary

Product scope (from `VISION.md`) is enforced **structurally at the Schema layer, not in the UI**: external data is filtered and narrowed during decode, before it reaches any other code. Anything outside scope is dropped at the boundary. Signed-in data follows the same rule (for example, the purchased list holds PS5 games only). No user preferences, no stored per-user state, no telemetry. Per-user data comes only from the Sony sign-in; §14 fixes its mechanics. If a change cannot fit the scope, surface it rather than expanding it.

---

## 1. Language & Runtime

- **Primary language:** TypeScript 6.x (strict).
- **Strictness mode (non-negotiable `tsconfig`):** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`.
- **Target runtime:** Node.js 24 LTS, pinned to 24.21.0 for development.
- **Minimum runtime version:** Node 24.21.0 (no back-deployment).
- **Package manager:** pnpm 12.8.1 (workspaces). **Lockfile:** `pnpm-lock.yaml`.
- **Toolchain bootstrap:** `mise install` provisions Node and pnpm from `mise.toml`, the source of truth. Change the mirrors in the same commit: `.nvmrc` and `engines.node` (the floor) in the root `package.json` for Node, and `packageManager` in the root `package.json` for pnpm. `pmOnFail: error` in `pnpm-workspace.yaml` fails a pnpm version mismatch. Keep `mise.toml` to `[tools]` only.

---

## 2. Frameworks

| Concern             | Technology                                                    | Role                                                                                      |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Backend core        | Effect v3                                                     | Side effects as values; typed errors (`Effect<A, E, R>`); DI via `Layer`                  |
| Schema / validation | Effect Schema (`effect/Schema`)                               | Decode + narrow external data at the boundary (hand-written, single API → no codegen)     |
| REST layer          | `@effect/platform` HttpApi                                    | End-to-end typed routes + generated OpenAPI; thin handlers                                |
| Server cache        | Effect `Cache`                                                | In-memory, built-in TTL, deterministically testable with `TestClock`                      |
| Frontend UI         | React 19 + Vite                                               | Foundation; function components only                                                      |
| Routing             | TanStack Router (SPA); TanStack Start only if SSR is required | Type-safe routing                                                                         |
| Client cache        | TanStack Query                                                | TTL, background refetch, persisted to `localStorage`/IndexedDB via the official persister |
| Styling             | Tailwind CSS v4                                               | Utilitarian; no decorative chrome                                                         |
| Tests               | Vitest                                                        | Pure functions + Effect test `Layer`s                                                     |
| Lint                | ESLint + typescript-eslint                                    | `no-explicit-any` + `no-unsafe-*` as CI gates                                             |

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
2. **Pin the version in the query.** Especially Effect: always target the v3 docs — model priors drift toward v2 / v4-beta, but the retrieved v3 docs are the source of truth, not memory.
3. **Targeted queries only.** Ask the question for the task at hand; do not retrieve whole documents speculatively (the Effect entry is large).
4. **Retrieve before integrating, not just before calling.** The riskiest code is the glue _between_ packages (e.g. wiring a service into an HttpApi handler). When per-package docs don't cover a seam, retrieve both sides and prefer the cohesive Effect-native path over hand-rolled glue.

---

## 4. Build & verify commands

| Variable      | Command                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `$FORMAT_CMD` | `pnpm format`                                                                                              |
| `$LINT_CMD`   | `pnpm lint` (ESLint; the gates below fail the build, not warn)                                             |
| `$BUILD_CMD`  | `pnpm build`                                                                                               |
| `$TEST_CMD`   | `pnpm test` (Vitest)                                                                                       |
| `$VERIFY_CMD` | `pnpm test-all` (format check → type-check → lint → build → tests → `sony:validate` → `sony:diff -- --ci`) |

The `package.json` scripts are the single source of truth. Never invoke `tsc`, `eslint`, `vitest`, or `vite` directly from commits, CI, or agent scripts.

**Narrow test selector** (for the mutation check): `pnpm --filter <workspace package> test <test file>`, for example `pnpm --filter @psstore/server test src/__tests__/mapper.test.ts`. The path is relative to the workspace package.

### Other checks

`$VERIFY_CMD` checks the Sony boundary against committed fixtures only. It does not reach live Sony. The two checks below do. `docs/contracts/sony-graphql-runbook.md` is the reference for both.

| Check               | Trigger                                                                                                                | Who runs it                                                                                                  | Evidence in the PR                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:live`    | The diff touches `server/src/sony/**` or `server/src/domain/listing.ts`.                                               | The PR author (`lead-dev`), on the pushed head.                                                              | The per-feature counts (NEW / UPCOMING / DISCOUNTED) and the resolved PDP SKU. A PR without them fails review.            |
| `pnpm sony:refresh` | No diff trigger. The owner runs it weekly. A persisted-query hash rotation also needs it (runbook → Failure handling). | Owner-run. An agent runs it only when the owner asks in the current task or the task is a hash-rotation fix. | On drift: the refreshed `docs/contracts/sony-graphql-manifest.json` and the hash constants in `server/src/config/env.ts`. |

Never schedule or automate either check (§10).

**Signed-in Sony flow.** A live check or a contract capture of the sign-in exchange or of a signed-in Sony operation needs a real NPSSO. Both are owner-run: the owner supplies their own NPSSO through an environment variable that is never committed. Agents never hold a real NPSSO or session token. When a diff touches the signed-in flow, list the live check in the PR as `triggered, pending owner run`, or `ran on <SHA>: PASS`.

---

## 5. Performance budgets

TBD. Let's aim for fast.

---

## 6. Persistence shape

- **Server:** in-memory Effect `Cache` only — TTL built in, no manual invalidation. **No database, no on-disk persistence, no per-visitor state.** Purchased-games requests and the sign-in exchange bypass the cache (§14).
- **Client:** TanStack Query cache persisted to `localStorage`/IndexedDB via the official persister, for anonymous store queries only. **No per-user state of any kind is persisted.** The session token and signed-in responses live in memory only (§14).
- **Persisted entities:** declared by `VISION.md → Persistence and Privacy Posture`.
- **Forbidden persistence:** accounts, user preferences, per-user state, telemetry, and anything forbidden in `VISION.md → Persistence and Privacy Posture`.

---

## 7. Approved dependencies

Default answer to "should we add a library?" is **no**. Track the latest **stable** version; pin exact versions in the lockfile; upgrade deliberately, not by drift. **Effect stays on v3** until a v4 migration is performed intentionally — v4-beta MUST NOT leak in via model priors or an unpinned install.

| Dependency                         | Version                                   | Context7 ID                             | Why it earns its place                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect` (+ Schema, Cache)         | `3.21.2`                                  | `/llmstxt/effect_website_llms-full_txt` | Backbone: typed effects, errors, DI                                                                                                                                                              |
| `@effect/platform`                 | `0.96.1`                                  | `/llmstxt/effect_website_llms-full_txt` | Typed HttpApi REST + OpenAPI. Published on a 0.x line (it never reached 1.0) while `effect` itself is genuinely 3.x; pinned exact to the build paired with `effect@3.21.2`.                      |
| `@effect/platform-node`            | `0.106.0`                                 | `/llmstxt/effect_website_llms-full_txt` | Node HttpServer + runtime adapter for HttpApi; same 0.x line, pinned exact to the build paired with `@effect/platform@0.96.1`.                                                                   |
| `typescript`                       | `6.x`                                     | `/microsoft/typescript`                 | Language                                                                                                                                                                                         |
| `react`                            | `19.x`                                    | `/facebook/react`                       | Frontend UI                                                                                                                                                                                      |
| `vite`                             | latest                                    | `/vitejs/vite`                          | Frontend build tool                                                                                                                                                                              |
| `@tanstack/react-router` (+ Start) | `1.x`                                     | `/tanstack/router`                      | Type-safe routing                                                                                                                                                                                |
| `@tanstack/react-query`            | `5.x`                                     | `/tanstack/query`                       | Client cache                                                                                                                                                                                     |
| `tailwindcss`                      | `4.x`                                     | `/tailwindlabs/tailwindcss`             | Utilitarian styling                                                                                                                                                                              |
| `vitest`                           | latest                                    | `/vitest-dev/vitest`                    | Test runner                                                                                                                                                                                      |
| `typescript-eslint`                | latest                                    | `/typescript-eslint/typescript-eslint`  | Typed lint gates                                                                                                                                                                                 |
| `pnpm`                             | `12.8.1` (`mise.toml` + `packageManager`) | `/pnpm/pnpm`                            | Package manager (runtime: Node 24 LTS, `/nodejs/node`)                                                                                                                                           |
| `dompurify`                        | `3.4.6`                                   | `/cure53/dompurify`                     | Client XSS control: sanitizes Sony-authored description HTML before `dangerouslySetInnerHTML` (`GameDetailsPage.tsx`). No platform equivalent. Approved pm/team 2026-05-31.                      |
| `luxon`                            | `3.7.2`                                   | `/moment/luxon`                         | Client ISO date parse + localized formatting (`GameCard.tsx`, `GameDetailsPage.tsx`). Kept; an `Intl.DateTimeFormat` swap is a deferred follow-up, not this change. Approved pm/team 2026-05-31. |
| `@types/luxon`                     | `3.7.1`                                   | `/moment/luxon`                         | Type definitions for `luxon`. Client devDependency only (de-duplicated from the root in this change). Approved pm/team 2026-05-31.                                                               |

New entries require a `STACK.md` PR with rationale, approver, and date.

**Tooling (not product runtime deps):** `playwright@1.60.0` is a devDependency of the Sony contract bot (`tools/sony-contract-bot`) used to capture the GraphQL contract during `pnpm sony:refresh`. It never ships in the server or client runtime and is intentionally excluded from the product-dependency table above.
mise is the toolchain bootstrap (§1), not a package dependency. Approved user/pm 2026-10-02.

---

## 8. Stack-specific reject-list additions

- **`any`** — explicit or implicit. `@typescript-eslint/no-explicit-any` and `no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-member-access` are **CI gates (build fails, not warns)**.
- **`throw` in domain logic** — model failures in the Effect error channel as tagged errors.
- **I/O imported directly into the pure core** (fetch, cache, clock) — provide them as Effect services / `Layer`s.
- **Untyped external data** reaching code before it is decoded and narrowed with Effect Schema.
- **`as` casts** that bypass type checking — use `satisfies` or a runtime/Schema guard.
- **`// @ts-ignore` / `// @ts-expect-error`** without an inline reason naming the underlying constraint.
- **`console.*` in shipped code** — use the structured logger (§9).
- **Class-based React components**; **`useEffect` for data fetching** — use TanStack Query.
- **Hand-rolled error-to-response glue** in HttpApi handlers — let the typed error channel map to status.
- **Effect v4-beta APIs** — v3 only until an intentional migration.
- **Writing package code from memory** without the §3 Context7 retrieval.
- **Local-time instants or hand-rolled UTC-offset arithmetic**, and new ambient `Date.now()` / `new Date()` reads in domain code — see §12.
- **A Sony credential or per-user data outside its allowed path** — see §14. This covers: an NPSSO, session token, refresh token, account identifier, or signed-in response data in any cache, storage, log, URL, cookie, or committed file; a server-side session or sign-in cookie; and a kept refresh token.

---

## 9. Logging & privacy

- **Logger:** Effect's logging (`Effect.log*`) on the server, structured; never `console.*` in shipped code.
- **No PII / no telemetry.**
- **Language:** everything the user sees is in English: UI chrome (labels, placeholders, error states), Sony game data, and formatted dates. Request Sony data from the Finnish store (EUR) in English.
- **Sony credentials:** the server types the NPSSO and the session token as `Redacted<string>` (§14), so a log line prints `<redacted>`. Never log the headers or the body of the sign-in request or a signed-in request, an account identifier, or signed-in response data.
- **Crash / error reporter:** none by default; if added, declare it in §7 with data-flow justification.

---

## 10. Background & lifecycle

- **Allowed:** TTL-bounded cache refresh driven by request access (Effect `Cache`).
- **Forbidden:** background polling or long-lived connections without active user interaction; any background work that retains data forbidden by `VISION.md`; background session refresh or background refetch of signed-in data.

---

## 11. Definition-of-done additions

On top of `CLAUDE.md → Definition of done`, this stack also requires: `tsc` zero errors; ESLint zero errors (the §8 `no-any` / `no-unsafe-*` gates); no I/O imported into the pure core; no `throw` in domain logic; any new package usage grounded in §3 Context7-retrieved, version-pinned docs; and no Sony credential or signed-in data in a log, cache, persisted storage, or committed file (§14). The compiler and this checklist are the review — design code so the checklist _can_ catch mistakes.

---

## 12. Time & timezones

UTC everywhere internally. Convert only at the boundary (`CLAUDE.md → Time`). This section pins the mechanics.

- **Internal representation:** an instant is a UTC ISO-8601 string with a `Z` suffix (for example `Game.date`), or epoch milliseconds for a comparison. A value with an implicit local offset is forbidden. A missing or unparseable upstream date maps to the empty string, never to a guessed instant.
- **Inbound boundary (server):** the Sony mapper (`server/src/sony/mapper.ts`) normalises each upstream date to UTC: `Date.parse`, then `new Date(ms).toISOString()`.
- **Wire:** the API contract carries the UTC string unchanged.
- **Outbound boundary (client):** only the rendering component converts an instant to a local date: luxon `DateTime.fromISO(value)`, then `toLocaleString(DateTime.DATE_MED)` with an English locale (§9). The result uses the viewer's system timezone.
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

`VISION.md → Persistence and Privacy Posture` sets the policy. This section fixes the mechanics for every feature that uses the user's Sony sign-in. PURCHASED is the first one.

- **Credential:** the user pastes their NPSSO token into the sign-in form. Sony offers no public OAuth for third parties. The NPSSO flow is unofficial and undocumented. Treat the NPSSO as a full account credential. The reference for the exchange and for signed-in operations such as the purchased-games list is the `psn-api` documentation (Context7 `/achievements-app/psn-api`). Adding `psn-api` itself as a dependency needs a §7 entry like any other package.
- **Exchange:** the client sends the NPSSO once, in a request body, to the backend. The backend exchanges it with Sony for a short-lived session (access) token. The backend returns only the session token and its expiry. The backend discards the NPSSO and any refresh token in the same request.
- **Client:** the session token lives in React state only. It never goes into `localStorage`, `sessionStorage`, IndexedDB, a cookie, a URL, or a query key. Sign-out, reload, tab close, or expiry discards it.
- **Requests:** the client sends the session token in the `Authorization` header to each route that needs the sign-in. The backend forwards it to Sony and returns the decoded result. There is no server session and no sign-in cookie.
- **Server types:** decode the NPSSO and the session token with `Schema.Redacted(Schema.String)`. Read the raw value with `Redacted.value` only at the Sony client call.
- **Caching:** the sign-in exchange and the signed-in routes never use the Effect `Cache`. On the client, the persister allow-list (`shouldDehydrateQuery` in `client/src/main.tsx`) admits only the anonymous `games` and `game` keys. Never add a signed-in query to the allow-list. Remove signed-in queries from the cache on sign-out.
- **Scope:** decode signed-in responses with Effect Schema and narrow them to the product scope at the boundary, like anonymous data. For the purchased list, drop PS4 titles, apps, and add-ons.
- **Errors:** a rejected or expired session maps to a typed error with HTTP 401. The client then discards the token and shows the signed-out state. An unavailable Sony sign-in or signed-in service maps to the same 502 / 503 errors as other upstream failures.
- **Contract:** the sign-in exchange and each signed-in operation go through the Sony contract tooling like the anonymous operations. Capture and live checks need a real NPSSO, so the owner runs them (§4 → Other checks).
- **Fixtures:** committed manifests, golden fixtures, and samples never contain a real NPSSO, session token, refresh token, account identifier, or real signed-in response data. Use synthetic values.
- **XSS:** an XSS bug can now steal a session token. Keep DOMPurify on every Sony-authored HTML string. Add no new `dangerouslySetInnerHTML`.

---

## 15. Intentional Divergences

| Date     | CLAUDE.md rule | Divergence | Reason |
| -------- | -------------- | ---------- | ------ |
| _(none)_ | —              | —          | —      |
