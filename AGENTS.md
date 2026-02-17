# Repository Guidelines

## Project Structure & Module Organization

- `client/` — Vite + React SPA.
- `server/` — Express API (Railway runtime) and Sony GraphQL adapter.
- `shared/` — shared TypeScript types, Zod schemas, and utility functions.
- Client talks only to `/api/*`; Sony GraphQL requests must be server-side only.
- Production client bundle output is `client/build`.

## Build, Test, and Development Commands

- `npm install` — Install workspace dependencies.
- `npm run dev` — Run server and client in local development.
- `npm run lint` — Run ESLint/Stylelint checks.
- `npm run typecheck` — Run TypeScript checks.
- `npm run test` — Run Vitest suites in all workspaces.
- `npm run build` — Build shared, client (`client/build`), and server artifacts.
- `npm run start` — Start production server (serves API + static client bundle).

## Mandatory Quality Gates (Required Every Time)

Agents must run **all** gates below after any code change and before presenting final changes, creating a commit, or opening a PR:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`

Rules:
- Do not skip any required gate, even for small edits.
- If one command fails, fix it, rerun that command, then rerun the full gate sequence.
- If environment issues block a gate, report the exact blocker and what was still verified.

## Coding Style & Quality Expectations

- TypeScript strict mode; avoid `any` and other catch-all types.
- Prefer explicit parameter and return types for public functions.
- Favor pure functions and immutable transformations where practical.
- Keep fixes minimal and scoped; avoid unrelated refactors.
- Reuse existing logic instead of duplicating behavior.
- CSS classes follow existing BEM-like naming conventions (for example, `games--filter-name`).

## Testing Guidelines

- Use Vitest for unit tests.
- Add focused tests for changed behavior in `client/src/**/__tests__`, `server/src/**/__tests__`, or `shared/src/**/__tests__`.
- Keep tests deterministic and mock external network behavior.

## Commit & Branch Guidelines

- Never commit directly to `main`/`master`.
- Use feature branches (prefer `codex/*` naming).
- Keep commits logical and atomic; do not mix unrelated changes.
- Commit messages should be concise and imperative.

## Security & Runtime Guidelines

- Do not call Sony GraphQL directly from browser code.
- Validate external inputs and upstream payloads with Zod at server boundaries.
- Never commit secrets or tokens.
- Keep Railway runtime assumptions intact: server serves `/api/*` and SPA fallback from `client/build`.

## Agent Reporting Format

Final delivery updates should include:

- `Scope:` changed files/modules
- `Checks run:` exact commands
- `Result:` pass/fail per command
- `Fixes applied:` short list
- `Open issues:` unresolved blockers only
