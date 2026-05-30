# STACK.md — TypeScript + Effect profile

> Effect-backed TypeScript: a `@effect/platform` HttpApi backend (typed REST + generated OpenAPI) plus a React + Vite SPA, in a pnpm monorepo sharing Effect Schema across server ↔ client. Effect is the backbone because correctness must be machine-checkable: typed errors and Layer-provided dependencies maximise what the compiler proves. **Normative** — MUST / MUST NOT are binding; surface conflicts before deviating.

---

## 0. Project shape

- **Shape:** backend service (typed REST via `@effect/platform` HttpApi) + React SPA frontend.
- **Critical execution path:** the per-request hot path on the server; the browser main thread / React render path on the web.
- **Applicable states:** web surfaces handle awaiting-first-data, success, empty, degraded, offline, error; API responses are typed success / typed error (the Effect error channel maps to HTTP status). No per-user state.

## Scope boundary

Product scope (from `VISION.md`) is enforced **structurally at the Schema layer, not in the UI**: external data is filtered and narrowed during decode, before it reaches any other code. Anything outside scope is dropped at the boundary. No accounts, no user preferences, no per-user state, no telemetry. If a change cannot fit the scope, surface it rather than expanding it.

---

## 1. Language & Runtime

- **Primary language:** TypeScript 6.x (strict).
- **Strictness mode (non-negotiable `tsconfig`):** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`.
- **Target runtime:** Node.js 24 LTS.
- **Minimum runtime version:** Node 24.0 (no back-deployment).
- **Package manager:** pnpm (workspaces). **Lockfile:** `pnpm-lock.yaml`.

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

## 3. Documentation protocol (Context7)

**Hard rule: never write or modify code that uses a package in §7 from memory. Retrieve version-pinned docs via Context7 first** (the `find-docs` skill or the Context7 MCP).

1. **Resolve, don't guess.** If a Context7 ID in §7 fails to resolve, use Context7's library-id resolver and take the canonical ID it returns. Never invent an API without resolved docs backing it.
2. **Pin the version in the query.** Especially Effect: always target the v3 docs — model priors drift toward v2 / v4-beta, but the retrieved v3 docs are the source of truth, not memory.
3. **Targeted queries only.** Ask the question for the task at hand; do not retrieve whole documents speculatively (the Effect entry is large).
4. **Retrieve before integrating, not just before calling.** The riskiest code is the glue _between_ packages (e.g. wiring a service into an HttpApi handler). When per-package docs don't cover a seam, retrieve both sides and prefer the cohesive Effect-native path over hand-rolled glue.

---

## 4. Build & verify commands

| Variable      | Command                                                        |
| ------------- | -------------------------------------------------------------- |
| `$FORMAT_CMD` | `pnpm format`                                                  |
| `$LINT_CMD`   | `pnpm lint` (ESLint; the gates below fail the build, not warn) |
| `$BUILD_CMD`  | `pnpm build`                                                   |
| `$TEST_CMD`   | `pnpm test` (Vitest)                                           |
| `$VERIFY_CMD` | `pnpm test-all` (type-check → lint → build → tests)            |

The `package.json` scripts are the single source of truth. Never invoke `tsc`, `eslint`, `vitest`, or `vite` directly from commits, CI, or agent scripts.

---

## 5. Performance budgets

TBD. Let's aim for fast.

---

## 6. Persistence shape

- **Server:** in-memory Effect `Cache` only — TTL built in, no manual invalidation. **No database, no on-disk persistence, no per-visitor state.**
- **Client:** TanStack Query cache persisted to `localStorage`/IndexedDB via the official persister. **No per-user state of any kind.**
- **Persisted entities:** declared by `VISION.md → Persistence and Privacy Posture`.
- **Forbidden persistence:** accounts, user preferences, per-user state, telemetry, and anything forbidden in `VISION.md → Persistence and Privacy Posture`.

---

## 7. Approved dependencies

Default answer to "should we add a library?" is **no**. Track the latest **stable** version; pin exact versions in the lockfile; upgrade deliberately, not by drift. **Effect stays on v3** until a v4 migration is performed intentionally — v4-beta MUST NOT leak in via model priors or an unpinned install.

| Dependency                         | Version | Context7 ID                             | Why it earns its place                                 |
| ---------------------------------- | ------- | --------------------------------------- | ------------------------------------------------------ |
| `effect` (+ Schema, Cache)         | `3.x`   | `/llmstxt/effect_website_llms-full_txt` | Backbone: typed effects, errors, DI                    |
| `@effect/platform`                 | `3.x`   | `/llmstxt/effect_website_llms-full_txt` | Typed HttpApi REST + OpenAPI                           |
| `typescript`                       | `6.x`   | `/microsoft/typescript`                 | Language                                               |
| `react`                            | `19.x`  | `/facebook/react`                       | Frontend UI                                            |
| `vite`                             | latest  | `/vitejs/vite`                          | Frontend build tool                                    |
| `@tanstack/react-router` (+ Start) | `1.x`   | `/tanstack/router`                      | Type-safe routing                                      |
| `@tanstack/react-query`            | `5.x`   | `/tanstack/query`                       | Client cache                                           |
| `tailwindcss`                      | `4.x`   | `/tailwindlabs/tailwindcss`             | Utilitarian styling                                    |
| `vitest`                           | latest  | `/vitest-dev/vitest`                    | Test runner                                            |
| `typescript-eslint`                | latest  | `/typescript-eslint/typescript-eslint`  | Typed lint gates                                       |
| `pnpm`                             | latest  | `/pnpm/pnpm`                            | Package manager (runtime: Node 24 LTS, `/nodejs/node`) |

New entries require a `STACK.md` PR with rationale, approver, and date.

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

---

## 9. Logging & privacy

- **Logger:** Effect's logging (`Effect.log*`) on the server, structured; never `console.*` in shipped code.
- **No PII / no telemetry.** UI chrome (labels, placeholders, error states) is in English; externally-sourced data follows its own locale (e.g. `fi-fi`, falling back to English).
- **Crash / error reporter:** none by default; if added, declare it in §7 with data-flow justification.

---

## 10. Background & lifecycle

- **Allowed:** TTL-bounded cache refresh driven by request access (Effect `Cache`).
- **Forbidden:** background polling or long-lived connections without active user interaction; any background work that retains data forbidden by `VISION.md`.

---

## 11. Definition-of-done additions

On top of `CLAUDE.md → Definition of done`, this stack also requires: `tsc` zero errors; ESLint zero errors (the §8 `no-any` / `no-unsafe-*` gates); no I/O imported into the pure core; no `throw` in domain logic; and any new package usage grounded in §3 Context7-retrieved, version-pinned docs. The compiler and this checklist are the review — design code so the checklist _can_ catch mistakes.

---

## 12. Intentional Divergences

| Date     | CLAUDE.md rule | Divergence | Reason |
| -------- | -------------- | ---------- | ------ |
| _(none)_ | —              | —          | —      |
