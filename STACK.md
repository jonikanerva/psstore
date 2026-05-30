# STACK.md — Strict TypeScript / Effect v3 / @effect/platform / React 19 / TanStack / Tailwind v4 profile

> **Status: normative.** This is the definitive technology specification for the project. Agents and skills MUST follow it. Where it uses MUST / MUST NOT / SHOULD, treat them as binding (RFC 2119 sense). If a request conflicts with this file, surface the conflict before proceeding — do not silently deviate.
>
> Strict TypeScript monorepo with an Effect v3 backend (`server/`) exposing a typed REST layer via `@effect/platform` HttpApi behind a thin adapter, a React 19 + Vite frontend (`client/`), a shared `shared/` module carrying the Effect Schema contracts used on both sides, and a sony-contract-bot CLI (`tools/sony-contract-bot/`). Package manager: pnpm workspaces. Vitest for tests.
>
> Chosen architecture: **Effect** as the backbone. Rationale: the owner does not read code, so correctness must be _machine-checkable_. Effect maximizes what the compiler can prove (typed errors, required dependencies via `Layer`), and the documentation protocol in §0.1 neutralizes the only serious downside (API / version unfamiliarity). The automated review gate (`/codereview` + `qa-enforcer`) is retained on top of the compiler as the project's semantic safety net — see §12.

---

## 0. Core principles

These are invariants. Every change is measured against them. They are _decisions_, not implementation details — they do not change when a module choice changes (see §0.1 and the normative-depth note in §2).

- **No `any`.** Explicit or implicit. Enforced by strict `tsconfig` + typed lint as error-level gates (see §1, §7).
- **Functional core, imperative shell.** Pure functions compute; I/O lives at the edge. The core MUST NOT import I/O modules (`fetch`, the cache, the clock, any `@effect/platform` module) directly — they are provided as Effect services / `Layer`s declared in the program's `R` channel. This boundary is enforced **as a lint rule**, not a convention (see §7) — a program with an unmet `R` cannot run, and the import boundary is machine-checked.
- **Errors are values.** No `throw` in domain / core logic. Failures are modeled in the Effect error channel (`E`) as tagged errors (`Data.TaggedError`), so the compiler forces every failure path to be handled. The boundary (HttpApi handler / React edge) maps tagged errors to HTTP status / UI state.
- **The compiler is the reviewer — and not the only one.** Prefer designs where a mistake is a compile error over designs that rely on discipline or runtime checks. This is the project's primary safety mechanism. It is backstopped, not replaced, by the automated `/codereview` gate (§12) — because the type system provably cannot catch logic errors, mis-narrowing decoders, or scope-boundary regressions.
- **External data is untrusted until decoded.** Sony's GraphQL is `unknown` until it passes an Effect `Schema` decode that narrows it to **PS5 / Finland / EUR** at the boundary, before it touches any other code. The product scope is enforced _here_, at decode, not in the UI.

---

## 0.1 Documentation protocol (mandatory)

**Hard rule: never write or modify code that uses a library from the model's memory. Retrieve the version-pinned docs via Context7 first.**

Before generating or editing any code that touches a package in the table below, the agent MUST query Context7 for that package, scoped to the pinned version (the canonical version pins live in §6 — this table maps packages to their Context7 IDs), with a targeted question. Do not dump whole docs into context — ask a specific question (the Effect entry is large).

Pattern:

```
ctx7 docs "<context7-id>" "<specific question for the exact task>"
```

| Package                                       | Context7 ID                             |
| --------------------------------------------- | --------------------------------------- |
| effect (+ Schema, Cache)                      | `/llmstxt/effect_website_llms-full_txt` |
| @effect/platform (HttpApi, HttpClient/Server) | `/llmstxt/effect_website_llms-full_txt` |
| typescript                                    | `/microsoft/typescript`                 |
| node                                          | `/nodejs/node`                          |
| react                                         | `/facebook/react`                       |
| vite                                          | `/vitejs/vite`                          |
| @tanstack/react-router (+ Start)              | `/tanstack/router`                      |
| @tanstack/react-query (+ persist-client)      | `/tanstack/query`                       |
| tailwindcss                                   | `/tailwindlabs/tailwindcss`             |
| vitest                                        | `/vitest-dev/vitest`                    |
| typescript-eslint                             | `/typescript-eslint/typescript-eslint`  |
| pnpm                                          | `/pnpm/pnpm`                            |

Rules:

1. **Resolve, don't guess.** If a listed Context7 ID fails to resolve, call Context7's library-id resolver and use the canonical ID it returns. Never invent an API without resolved docs backing it.
2. **Pin the version in the query.** Effect especially: always target the v3 docs. The model's priors may drift toward v2 or v4-beta syntax — the retrieved v3 docs are the source of truth, not memory. Confirm the retrieved content is v3 before relying on it.
3. **Targeted queries only.** Ask the question for the task at hand; do not retrieve entire documents speculatively.
4. **Retrieve before integrating, not just before calling.** The riskiest code is the glue _between_ packages (e.g. wiring an Effect service `Layer` into an HttpApi handler). When per-package docs don't cover a seam, retrieve both sides and prefer the cohesive Effect-native path over hand-rolled glue.
5. **Record the grounding.** Every PR whose diff uses or changes a package above records, in its description: the Context7 ID queried, the question asked, and the API shape it confirmed. A package seam with no grounding entry is an incomplete change — `qa-enforcer` FAILs it (see §12 and `.claude/skills/codereview`).

This protocol is a first-class operating rule, not a divergence. It is cross-referenced from `AGENTS.md §14`, `CLAUDE.md`, and the `architect` / `lead-dev` agent instructions.

---

## 1. Language & Runtime

- **Primary language:** TypeScript 5.x (latest stable). _Owner-owned via issue #68; supersedes the previous "6.0" target — see §13 Intentional Divergences._
- **Strictness mode (non-negotiable):** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`, `"verbatimModuleSyntax": true`.
- **Lint as error-level gates (not warnings):** ESLint + `typescript-eslint`. The build MUST fail — not warn — on `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unsafe-assignment`, `@typescript-eslint/no-unsafe-call`, `@typescript-eslint/no-unsafe-member-access`. Schema decoding handles boundary safety structurally; these rules are the net that catches anything that slips past. Two further error-level `no-restricted-imports` rules enforce structural boundaries (see §7): the functional-core I/O boundary, and the `@effect/platform` adapter boundary.
- **Target runtime:** Node.js 24 (Krypton — active LTS).
- **Minimum runtime version:** Node 24.0 (no back-deployment to Node 22 / 20).
- **Package manager:** pnpm (workspaces).
- **Lockfile:** `pnpm-lock.yaml`.

---

## 2. Frameworks

The **decisions** below are normative (MUST). The **module-level API shapes** are the chosen target; their exact wiring is grounded in Context7-retrieved v3 docs at implementation time (§0.1) — the spec commits to the direction, not to API details remembered from training data.

| Concern             | Framework / library                                   | Notes                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend core        | Effect v3                                             | Side effects as values, typed error channel `Effect<A, E, R>`, dependency injection via `Layer`. The backbone. Authorised DI mechanism — see §6, §7.                                                                       |
| Schema / validation | Effect Schema (`effect/Schema`)                       | Decode + narrow Sony's data to PS5 / FI / EUR at the boundary. Hand-written schemas (single external API → no codegen).                                                                                                    |
| REST layer          | `@effect/platform` HttpApi, **behind a thin adapter** | Typed routes + generated OpenAPI. The HTTP binding is isolated behind one adapter module (see §13 — HttpApi is upstream-Unstable). Handlers are thin: decoded input → pure core → typed `E` channel mapped to HTTP status. |
| Cache (server)      | Effect `Cache`                                        | In-memory, built-in TTL, testable with `TestClock`. Replaces the hand-rolled `server/src/lib/cache.ts`. No DB, no on-disk state.                                                                                           |
| Frontend UI         | React 19 + Vite                                       | Function components only.                                                                                                                                                                                                  |
| Routing             | TanStack Router 1.x (SPA)                             | TanStack Start only if SSR / server functions are required (not the default).                                                                                                                                              |
| Data / client cache | TanStack Query 5.x                                    | TTL, background refetch, staleness. Persisted to `localStorage` / IndexedDB via `@tanstack/react-query-persist-client`. Caches **Sony response payloads only, never per-user state** (see §5).                             |
| Styling             | Tailwind CSS v4                                       | Utilitarian surface, no decorative chrome. Chrome (labels, placeholders, error states) in English; game data follows Sony `fi-fi`.                                                                                         |
| Monorepo            | pnpm workspaces                                       | Shared Effect Schema across server ↔ client via `shared/`.                                                                                                                                                                 |
| Testing             | Vitest                                                | Pure functions + Effect test `Layer`s (§11). Playwright optional for end-to-end.                                                                                                                                           |
| Logging             | `console.*` / `Effect.log` on server and CLI tools    | pino not adopted; PII redaction rules in §8 apply regardless of sink.                                                                                                                                                      |
| Telemetry           | none by default                                       | Add only with explicit `STACK.md` approval.                                                                                                                                                                                |
| Formatting          | Prettier 3                                            |                                                                                                                                                                                                                            |
| Linting             | ESLint + `typescript-eslint` (flat config)            | Error-level gates per §1, §7.                                                                                                                                                                                              |
| CSS                 | Tailwind CSS v4 (utility-first)                       | Stylelint retained only if hand-authored CSS survives the Tailwind migration — decided at implementation.                                                                                                                  |

---

## 3. Build & verify commands

| Variable      | Command                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `$FORMAT_CMD` | `pnpm format`                                                                                     |
| `$LINT_CMD`   | `pnpm lint`                                                                                       |
| `$BUILD_CMD`  | `pnpm build`                                                                                      |
| `$TEST_CMD`   | `pnpm test`                                                                                       |
| `$VERIFY_CMD` | `pnpm test-all` (type-check → lint → build → tests → sony contract validate → sony contract diff) |

The `package.json` scripts are the single source of truth. Never invoke `eslint`, `tsc`, `vitest`, or `vite` directly from commits or agent scripts.

> **Migration note.** The command _names_ and _contract_ above are stable across the migration. The script _bodies_ (what `build` / `lint` compile and gate) are rewired during the **code-implementation phase**, not the documentation phase — `lint` gains the error-level `no-unsafe-*` / `no-restricted-imports` rules, `build` compiles the Effect / HttpApi server. The `sony:validate` / `sony:diff` steps are stack-independent (they live in `tools/sony-contract-bot/`) and remain in `$VERIFY_CMD`. Until the code phase lands, `pnpm test-all` continues to gate the current codebase unchanged.

---

## 4. Performance budgets

- **API request p99:** 100 ms (per route, excluding upstream calls).
- **API request p50:** 30 ms.
- **Cold start (Node):** < 2 s. _Measure Effect runtime + `Layer` construction cost against this during the code phase._
- **Web bundle:** < 200 KB gzipped initial JS, < 50 KB gzipped initial CSS. _TanStack Router + Query + Tailwind v4 (and any Effect Schema shared to the client) are not free — the migration MUST measure bundle size against this budget; it is not pre-relaxed._
- **Time to Interactive (web, slow 4G simulation):** < 3 s.
- **Memory ceiling (API container):** < 512 MB resident.

_(The previous "cold start (edge runtime) < 500 ms" budget is dropped: the project deploys to Railway on the Node runtime, and `@effect/platform` runs on the Node adapter — no edge runtime is in scope.)_

---

## 5. Persistence shape

- **Storage primitive (server):** Effect `Cache` (in-memory, built-in TTL) for Sony GraphQL responses. No database, no on-disk state. TTL behavior is verified deterministically with `TestClock` (§11).
- **Storage primitive (client):** browser storage (`localStorage` / IndexedDB) via `@tanstack/react-query-persist-client`, for caching Sony response payloads only, to speed up page reloads. The persister stores **Sony response payloads only** — never query keys or state that encode user behaviour (search terms, viewed PDPs), never user preferences (per `VISION.md → Persistence and Privacy Posture`). Cache entries carry a short TTL.
- **Persisted entities:** Sony GraphQL response payloads only.
- **Schema migration policy:** N/A — no persistent schema.
- **Forbidden persistence:** anything declared forbidden in `VISION.md → Persistence and Privacy Posture` (user identifiers, preferences, click / search / viewing history, etc.).

---

## 6. Approved dependencies

Default answer to "should we add a library?" is **no**. The lists below are intentionally short; new entries require a `STACK.md` PR with justification. **This table is the single canonical source of version pins** (the §0.1 Context7 table maps to docs IDs only). Track the latest **stable** version of every dependency; pin in the lockfile; upgrade deliberately, not by drift.

| Dependency                             | Version           | Why it earns its place                                                                                                                                                                   | Approver    | Date       |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| `effect`                               | `3.x` (pin minor) | Backend backbone: effects-as-values, typed errors, **`Layer` is the project's authorised DI mechanism**. Ships Schema + Cache. **MUST stay on v3** — v4-beta MUST NOT leak in (§7, §13). | owner / #68 | 2026-05-30 |
| `@effect/platform`                     | exact `0.x` minor | Typed REST layer (HttpApi) + HttpClient/Server. **Pinned to an exact `0.x` minor (no `^`)** because it is `0.x` and upstream-Unstable (§13).                                             | owner / #68 | 2026-05-30 |
| `react` / `react-dom`                  | `19.x`            | Frontend UI framework. Function components only.                                                                                                                                         | owner / #68 | 2026-05-30 |
| `vite`                                 | latest stable     | Frontend build tool.                                                                                                                                                                     | owner / #68 | 2026-05-30 |
| `@tanstack/react-router`               | `1.x`             | Type-safe frontend routing (SPA). Authorised — supersedes the previous react-router-dom.                                                                                                 | owner / #68 | 2026-05-30 |
| `@tanstack/react-query`                | `5.x`             | Client cache: TTL, background refetch, staleness. Authorised.                                                                                                                            | owner / #68 | 2026-05-30 |
| `@tanstack/react-query-persist-client` | `5.x`             | Official persister: Sony payloads → localStorage / IndexedDB. Sony data only (§5).                                                                                                       | owner / #68 | 2026-05-30 |
| `tailwindcss`                          | `4.x`             | Utility-first styling, no decorative chrome.                                                                                                                                             | owner / #68 | 2026-05-30 |
| `vitest`                               | latest stable     | Test runner.                                                                                                                                                                             | owner / #68 | 2026-05-30 |
| `@typescript-eslint/*`                 | latest stable     | TS-aware lint rules; provides the error-level `no-explicit-any` / `no-unsafe-*` gates (§1).                                                                                              | owner / #68 | 2026-05-30 |
| `eslint`                               | see §13           | Linter. Version held per the §13 `eslint-plugin-react` note until the React-19 lint config is proven.                                                                                    | owner / #68 | 2026-05-30 |
| `prettier`                             | `3.x`             | Formatter.                                                                                                                                                                               | owner / #68 | 2026-05-30 |
| `typescript`                           | `5.x` latest      | Language.                                                                                                                                                                                | owner / #68 | 2026-05-30 |

> **DI guardrail (anti-astronautics).** `effect`'s `Layer` is the _only_ authorised dependency-injection mechanism. This authorisation does **not** reopen the door to architecture astronautics (`AGENTS.md §1`, §13): no second DI system, service locator, or god object on top of Effect; services are **flat** — one `Layer` per external system (Sony client, cache, clock); no `Layer` whose only purpose is to compose other `Layer`s; no generic service factories. `/codereview` checks against this concrete shape.
>
> _Removed from the previous stack: `express` (→ `@effect/platform`), `react-router-dom` (→ `@tanstack/react-router`), `zod` (→ Effect Schema, which ships inside `effect`)._

---

## 7. Stack-specific reject-list additions

- `any` (explicit or implicit via `@typescript-eslint/no-explicit-any`) — **error-level gate**, no inline-reason escape hatch in shipped code.
- `@typescript-eslint/no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-member-access` violations — **error-level gates**, the build fails (not warns).
- `as` casts that bypass type checking, or casting past a `Schema` decode — use `satisfies`, a runtime guard, or decode properly.
- `// @ts-ignore` / `// @ts-expect-error` without an inline explanation that names the underlying constraint.
- **`throw` in domain / core logic.** Failures live in the Effect `E` channel as tagged errors; only the imperative shell / library-boundary adapters may bridge a thrown library error into the channel.
- **I/O module imported into a pure-core module.** Enforced by an error-level ESLint `no-restricted-imports` (or `import/no-restricted-paths`) rule scoped to the core directory: the core may not import `fetch`, the cache, the clock, or any `@effect/platform` module. I/O is injected via Effect `Layer`s.
- **`@effect/platform` imported outside the HTTP adapter module.** Enforced by an error-level ESLint `no-restricted-imports` rule: HttpApi / HttpServer types are confined to the one adapter file, so an upstream breaking change touches one file, not every route (see §13).
- **Effect `4.x` / `next` / any beta tag in the lockfile.** Effect stays on v3 until a v4 migration is performed intentionally. A v4-beta entry in `pnpm-lock.yaml` is a blocking finding.
- `moment` / `moment.js` — use `Temporal` (proposal) via polyfill or `date-fns` if approved.
- Full-import of `lodash` (`import _ from 'lodash'`) — import single functions only, or use the standard library equivalent.
- Any external read (Sony GraphQL or otherwise) **without Effect-Schema-decoded parsing** at the boundary. External data is `unknown` until `Schema.decode`.
- `console.log` calls that interpolate dynamic values without an inline redaction check (the `console.info` / `console.warn` / `Effect.log` allowance in §8 still requires PII-free fields).
- Default exports for non-component, non-route modules — prefer named exports for tree-shakability and refactor safety.
- `useEffect` with empty dependency arrays for data fetching in new code — use TanStack Query, or a small custom hook with abort handling.
- Class-based React components — function components only.
- Redux, MobX, Recoil, Jotai unless `§6 → Approved dependencies` explicitly authorises them. _(TanStack Query / Router ARE now authorised in §6 — they are no longer on this list.)_
- Ad-hoc singletons / module-level mutable service instances instead of `Layer`-based DI (see the §6 DI guardrail).
- `process.env.X` reads outside a single typed config module (Effect `Config` / a validated `env` module) that re-exports typed constants.

---

## 8. Logging & privacy

- **Logger:** `console.*` / `Effect.log` on backend (`server/src/`) and CLI tools (`tools/sony-contract-bot/src/`). pino not adopted; the redaction rules below transfer to any sink, including Effect's logger.
- **PII redaction:** code paths emitting dynamic values must filter sensitive fields explicitly before output. No PII — user identifiers, IP addresses, click history, search terms — is logged at any level.
- **Crash / error reporter:** none by default. If added (e.g. Sentry), declare it in `§6 → Approved dependencies` with explicit data-flow justification.

---

## 9. Background & lifecycle

- **Allowed background work:** TTL-based refresh inside the Effect `Cache` in the server process. No cron jobs, no scheduled tasks, no queues.
- **Forbidden background work:** long-polling websockets that keep a connection alive without active user interaction; background tabs that drive expensive computation; service workers that retain data forbidden by `VISION.md → Persistence and Privacy Posture`.

---

## 10. Concurrency mapping (TS / Effect)

`AGENTS.md §4 (C1–C13)` states the universal concurrency intent in platform-neutral terms. This table maps each intent to its Effect / TS equivalent — read `AGENTS.md §4` for the rule, this table for how it lands here. (The Node Effect runtime is single-threaded; "thread safety" maps to fiber-safe shared state, not OS threads.)

| AGENTS.md §4 intent                                 | Effect / TS equivalent                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| C2 — UI-thread isolation                            | React components stay pure; no heavy compute in render / view builders. Heavy work is an Effect run off the render path.               |
| C3 — shared mutable non-UI state behind a primitive | Effect services / `Ref` / `Cache` provided via `Layer`; never module-level mutable singletons.                                         |
| C4 — structured concurrency                         | `Effect.gen` + `yield*`; `Effect.all` / `Effect.forEach({ concurrency })`; scoped resources via `Layer` / `Scope` / `acquireRelease`.  |
| C5 — unstructured work needs justification          | `Effect.fork` / detached fibers only with an inline reason; prefer scoped fibers.                                                      |
| C7 — cancellation is mandatory                      | Effect **interruption** on scope exit; wire `AbortSignal` into `fetch` / TanStack Query so a disappearing view cancels its work.       |
| C8 / C9 — thread-safe value types at boundaries     | Immutable, Schema-decoded values cross boundaries; no mutable reference graphs shared between fibers.                                  |
| C10 — no sync-over-async block                      | Never block the Node event loop; no `deasync`-style sync-over-async bridge.                                                            |
| C12 — reactive frameworks only at boundaries        | Effect IS structured concurrency, not a reactive framework — it does not trip the §13 "reactive framework" ban. No RxJS on the client. |
| C13 — no warning silencers                          | Maps to the error-level `no-explicit-any` / `no-unsafe-*` gates and the "`@ts-expect-error` needs an inline reason" rule (§7).         |

---

## 11. Tests

- Use Vitest. Pure core functions are tested directly (highest-value tests — `AGENTS.md §9`).
- Effect programs run in tests with test `Layer`s providing fakes for the Sony client and cache — the `Live` / `Preview` / `Fake` pattern of `AGENTS.md §9` IS Effect `Layer` composition. No mocking frameworks: dependencies are injected via `Layer`s.
- Time-dependent logic (Cache TTL, background refresh) uses `TestClock`.
- **Schema decoders carry mandatory runtime tests.** The type system provably cannot verify that a decoder _narrows correctly_ — every Sony decoder has tests asserting the PS5 / Finland / EUR narrowing and the standard-vs-PS-Plus price mapping, including rejection of non-PS5 SKUs, non-game products, and null/odd prices. This is non-optional because the scope boundary (`VISION.md`) is decoder runtime behaviour, not a type.

---

## 12. Definition of done (stack additions)

Issue #68's machine-checklist is **added to**, not a replacement for, `AGENTS.md §15` — all §15 universals (responsiveness, every declared UI state handled, no heavy work on the render path, cancellation-safety, no forbidden persistence, accessibility, privacy declarations, docs) still apply. A change is done only when ALL of the following also hold:

1. `tsc` — zero errors (via `$VERIFY_CMD`).
2. ESLint — zero errors, including the error-level `no-explicit-any` / `no-unsafe-*` and the two `no-restricted-imports` boundary rules (§1, §7).
3. Vitest — all tests pass; new logic has tests; every Schema decoder has narrowing + price-mapping tests (§11).
4. No I/O module imported into the pure core (lint-enforced, §7).
5. No `throw` in domain logic; failures modeled in the Effect `E` channel (§0, §7).
6. Any new / changed library usage is grounded in Context7-retrieved, version-pinned docs, recorded in the PR description (§0.1).

> **Review gate (owner ruling, 2026-05-30).** Issue #68 states "there is no human code review downstream." This is interpreted as **no _human_ reviewer is assumed** — it does **not** remove the automated review gate. The `/codereview` (run by `qa-enforcer`) pass plus this green checklist ARE the review (see `CLAUDE.md → Skills`). This is a deliberate, owner-confirmed reading recorded as such because the type system cannot catch logic errors, mis-narrowing decoders, or scope-boundary regressions on a codebase the owner does not read. Recorded in §13.

---

## 13. Intentional Divergences

This table is the home for binding technical constraints that future work must respect (the kind of durable rule a feature PR establishes). Record them here and in the originating PR description — not as separate tracking issues.

| Date                                          | AGENTS.md rule                                     | Divergence                                                                                                                                                                                                    | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-30                                    | §0.1 framework-native / §16 intentional divergence | REST layer uses `@effect/platform` HttpApi despite its upstream **Unstable / experimental** status (confirmed in Effect's own docs).                                                                          | Issue #68 chooses HttpApi for end-to-end typed routes + generated OpenAPI, one Effect-native paradigm. Hedge (owner ruling 2026-05-30): the HTTP binding is isolated behind **one thin adapter module**; `@effect/platform` imports are confined to that file by an error-level ESLint `no-restricted-imports` rule (§7), so a breaking change between `0.x` minors touches one file, not every route. `@effect/platform` is pinned to an **exact `0.x` minor** (no `^`); upgrades are deliberate and re-grounded via Context7 (§0.1).                                                                                                                                                                                                                                                                                                         |
| 2026-05-30                                    | §6 Approved dependencies / strictness              | Effect pinned to **v3** (v4-beta forbidden).                                                                                                                                                                  | The model's priors drift toward v2 / v4-beta syntax. v3 is the source of truth; an `effect@4.x` / `next` / beta entry in `pnpm-lock.yaml` is a blocking finding (§7). v4 migration, when it happens, is intentional and separate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-30                                    | §15 Definition of done / CLAUDE.md review gate     | Issue #68's "no human code review downstream" is read as **no _human_ reviewer**, NOT as removing the automated gate.                                                                                         | Owner ruling 2026-05-30. The `/codereview` + `qa-enforcer` automated gate and the green machine-checklist together ARE the review. The compiler is the primary reviewer; the agent gate backstops the defect classes the type system cannot catch (logic, mis-narrowing decoders, scope regressions) on a codebase the owner does not read. See §12.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-05-30                                    | §1 Language version                                | TypeScript pinned at **5.x** (latest stable); supersedes the previous "6.0" target.                                                                                                                           | Owner ruling via issue #68; the language version is owner-owned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-05-28 (held — re-evaluate in code phase) | §6 Approved dependencies (ESLint version)          | ESLint version held pending the React-19 lint config.                                                                                                                                                         | The previous pin (`^9.39.4`) existed because `eslint-plugin-react@7.37.5` capped its peer dep at ESLint `^9.7`. The new stack (React 19 + TanStack + Tailwind) may drop `eslint-plugin-react` in favour of `@eslint-react/eslint-plugin`. **Do not auto-resolve:** the code phase proves the lint config on the chosen ESLint version (the error-level `no-unsafe-*` gates MUST actually run), then this row is updated or removed and the resolution recorded in that PR.                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-05-29 (rev. 2026-05-29)                  | §3 Architecture / VISION price principle           | UPCOMING surfaces ALL ~52 anonymously-available upcoming PS5 games — ~12 priced product-SKU cards (internal PDP) + ~40 concept-only cards (price "Unknown", linking out to Sony's `/en-fi/concept/{id}` page) | The `next_thirty_days` PS5 grid returns ~52 concepts: ~12 carry a product SKU + price, ~40 are announcement-only (`products: []`, `price: null`, no anonymous date). The earlier ceiling here (concept-only titles "correctly excluded / out of scope") is REVERSED by the owner ruling 2026-05-29 (option a): the UPCOMING view shows the concept-only titles without a price (marked "Unknown") and links them out to Sony's concept page (verified to resolve anonymously). UPCOMING uses a dedicated concept mapper + no empty-date drop; NEW / DISCOUNTED keep the SKU-gated shared mapper. Concept ids never resolve to an internal PDP (locked by test). _(Implementation function names from the previous stack are re-grounded as Effect-Schema decode paths during the code phase; the data-shape constraint is stack-independent.)_ |
| 2026-05-29                                    | §2 Frameworks / VISION views (four fixed views)    | The PS PLUS view is dropped; only NEW / UPCOMING / DISCOUNTED ship                                                                                                                                            | Sony's anonymous fi-fi GraphQL does not expose the monthly PS Plus catalogue: the `subscriptionService:PS_PLUS` filter is silently ignored (PS5-only, PS*PLUS-filtered, and a bogus token all return the identical full-catalogue count of 7214) and no `subscriptionService` facet exists. The `VISION.md → Open Questions` "PS Plus view feasibility" contingency triggered (2026-05-29): the view is dropped, no authentication is added. The PS Plus \_price* display (cards + PDP) is unaffected and remains a core principle.                                                                                                                                                                                                                                                                                                            |
