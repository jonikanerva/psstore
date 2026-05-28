# STACK.md — Strict TypeScript / Node LTS / Express / React / Vite / Vitest profile

> Strict TypeScript monorepo with an Express backend (`server/`), a React + Vite frontend (`client/`), a shared `shared/` module, and a sony-contract-bot CLI (`tools/sony-contract-bot/`). Package manager: pnpm workspaces. Vitest for tests.

---

## 1. Language & Runtime

- **Primary language:** TypeScript 6.0
- **Strictness mode:** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`, `"verbatimModuleSyntax": true`. ESLint with `@typescript-eslint/strict-type-checked`.
- **Target runtime:** Node.js 24 (Krypton — active LTS, latest 24.15.0)
- **Minimum runtime version:** Node 24.0 (no back-deployment to Node 22 / 20)
- **Package manager:** pnpm (workspaces)
- **Lockfile:** `pnpm-lock.yaml`

---

## 2. Frameworks

| Concern | Framework / library | Notes |
| ------- | ------------------- | ----- |
| Backend HTTP framework | Express 4 | Sony GraphQL proxy + in-memory cache; Hono considered but not adopted — no concrete benefit for this scope |
| Frontend UI | React 19 | Function components only |
| Build tool | Vite 8 (target) | For `client/` |
| State / observation | React built-ins (`useState`, `useReducer`) | No Redux / MobX |
| Routing | React Router DOM 7 (frontend) / Express router (backend) | TanStack Router not adopted |
| Data fetching (frontend) | Raw `fetch()` via `client/src/modules/psnStore.ts` | No TanStack Query / SWR; the API is read-only and simple |
| Validation | Zod 4 (target) | Boundary validation for every external input (HTTP, env, persisted state) |
| Persistence | In-memory cache (server) + browser storage for response caching (client) | See §5 |
| Testing | Vitest 4 (target) (unit + integration) | Playwright optional for end-to-end |
| Logging | `console.*` on server and CLI tools | pino not adopted; PII redaction rules in §8 still apply |
| Telemetry | none by default | Add only with explicit `STACK.md` approval |
| Formatting | Prettier 3 | |
| Linting | ESLint 10 (target) with `@typescript-eslint` flat config | |
| CSS linting | Stylelint 16 with project config | |

---

## 3. Build & verify commands

| Variable | Command |
| -------- | ------- |
| `$FORMAT_CMD` | `pnpm format` |
| `$LINT_CMD` | `pnpm lint` |
| `$BUILD_CMD` | `pnpm build` |
| `$TEST_CMD` | `pnpm test` |
| `$VERIFY_CMD` | `pnpm test-all` (type-check → lint → build → tests) |

The `package.json` scripts are the single source of truth. Never invoke `eslint`, `tsc`, `vitest`, or `vite` directly from commits, CI, or agent scripts.

---

## 4. Performance budgets

- **API request p99:** 100 ms (per route, excluding upstream calls).
- **API request p50:** 30 ms.
- **Cold start (edge runtime):** < 500 ms.
- **Cold start (Node):** < 2 s.
- **Web bundle:** < 200 KB gzipped initial JS, < 50 KB gzipped initial CSS.
- **Time to Interactive (web, slow 4G simulation):** < 3 s.
- **Memory ceiling (API container):** < 512 MB resident.

---

## 5. Persistence shape

- **Storage primitive (server):** in-memory cache (`server/src/lib/cache.ts`) for Sony GraphQL responses. TTL-based, no database, no on-disk state.
- **Storage primitive (client):** browser storage (`localStorage` and/or IndexedDB) for caching Sony response payloads only, to speed up page reloads. Never used for user preferences or behaviour state (per `VISION.md → Persistence and Privacy Posture`).
- **Persisted entities:** Sony GraphQL response payloads only.
- **Schema migration policy:** N/A — no persistent schema.
- **Forbidden persistence:** anything declared forbidden in `VISION.md → Persistence and Privacy Posture` (user identifiers, preferences, click / search / viewing history, etc.).

---

## 6. Approved dependencies

Default answer to "should we add a library?" is **no**. The lists below are intentionally short; new entries require a `STACK.md` PR with justification.

| Dependency | Version | Why it earns its place | Approver | Date |
| ---------- | ------- | ---------------------- | -------- | ---- |
| `express` | `^4.21` | Backend HTTP framework — incumbent, stable, sufficient for the Sony proxy | (default) | (template) |
| `react` | `^19` | Frontend UI framework | (default) | (template) |
| `react-router-dom` | `^7` | Frontend routing | (default) | (template) |
| `vite` | `^8` | Frontend build tool | (default) | (template) |
| `vitest` | `^4` | Test runner | (default) | (template) |
| `zod` | `^4` | Boundary validation for every external input | (default) | (template) |
| `@typescript-eslint/*` | `^8` | TS-aware lint rules | (default) | (template) |
| `eslint` | `^9` | Linter (see §10 Intentional Divergences — held at 9 pending `eslint-plugin-react` 10-compat) | (default) | (template) |
| `stylelint` | `^16` | CSS linter | (default) | (template) |
| `prettier` | `^3` | Formatter | (default) | (template) |
| `typescript` | `^6.0` | Language | (default) | (template) |

---

## 7. Stack-specific reject-list additions

- `any` (explicit or implicit via `@typescript-eslint/no-explicit-any`) without an inline `// reason: ...` justification.
- `as` casts that bypass type checking — use `satisfies` or a runtime guard.
- `// @ts-ignore` / `// @ts-expect-error` without an inline explanation that names the underlying constraint.
- `moment` / `moment.js` — use `Temporal` (proposal) via polyfill or `date-fns` if approved.
- Full-import of `lodash` (`import _ from 'lodash'`) — import single functions only, or use the standard library equivalent.
- Raw `fetch` without zod-validated response parsing for any external network call (client-side fetch in `psnStore.ts` is acknowledged in §11; new code must validate at the boundary).
- `console.log` calls that interpolate dynamic values without an inline redaction check (the existing `console.info` / `console.warn` allowance in §8 still requires PII-free fields).
- Default exports for non-component, non-route modules — prefer named exports for tree-shakability and refactor safety.
- `useEffect` with empty dependency arrays for data fetching in new code — wrap the fetch in a small custom hook with abort handling, or adopt a query library only after explicit approval.
- Class-based React components — function components only.
- Redux, MobX, Recoil, Jotai, TanStack Query, TanStack Router unless `Section 6 → Approved Dependencies` explicitly authorises them.
- `process.env.X` reads outside a single `env.ts` module that validates with zod and re-exports a typed constant.

---

## 8. Logging & privacy

- **Logger:** `console.*` on backend (`server/src/`) and CLI tools (`tools/sony-contract-bot/src/`). pino was considered but not adopted; if it is adopted later, the redaction rules below transfer unchanged.
- **PII redaction:** code paths emitting dynamic values must filter sensitive fields explicitly before output. No PII — user identifiers, IP addresses, click history, search terms — is logged at any level.
- **Crash / error reporter:** none by default. If added (e.g. Sentry), declare it in `Section 6 → Approved Dependencies` with explicit data-flow justification.

---

## 9. Background & lifecycle

- **Allowed background work:** TTL-based refresh inside the Express process's in-memory cache. No cron jobs, no scheduled tasks, no queues.
- **Forbidden background work:** long-polling websockets that keep a connection alive without active user interaction; background tabs that drive expensive computation; service workers that retain data forbidden by `VISION.md → Persistence and Privacy Posture`.

---

## 10. Intentional Divergences

| Date | AGENTS.md rule | Divergence | Reason |
| ---- | -------------- | ---------- | ------ |
| 2026-05-28 | §6 Approved dependencies (target ESLint `^10`) | ESLint pinned at `^9.39.4` | `eslint-plugin-react@7.37.5` (latest published) caps its peer dep at ESLint `^9.7`. ESLint 10 + this plugin fails at lint time (`contextOrFilename.getFilename is not a function`). Hold until `eslint-plugin-react` ships an ESLint-10-compatible release or the project migrates to `@eslint-react/eslint-plugin`. |
