# PS Store

A fast, utilitarian view of the Finnish PlayStation Store. It shows new, upcoming,
discounted, and monthly PS Plus **PS5 games** in the Finnish store, priced in **EUR** with both the standard and
**PS Plus** price visible — without the carousels, mixed platforms, and non-game products of
`store.playstation.com`. Open the page, see what's new, click out to Sony to buy. No
preferences, no tracking.

The backend proxies and normalises Sony's public GraphQL API into a clean REST surface scoped
to PS5 / Finland / EUR; the frontend renders what the backend returns.

## Architecture

- `client/` — Vite + React SPA (TanStack Router, TanStack Query, Tailwind CSS)
- `server/` — `effect/http-api` HttpApi backend on Effect (typed REST + in-memory Effect `Cache`)
- `shared/` — Effect Schema types, schemas, and utilities shared across server and client
- `tools/sony-contract-bot/` — captures and validates Sony's GraphQL contract

The browser talks only to `/api/*`. The server handles Sony GraphQL requests, decodes and
narrows the data at the Schema boundary, and serves the normalised result.

## Development

Prerequisite: [mise](https://mise.jdx.dev/). The `mise.toml` file pins the Node and pnpm
versions.

```bash
mise install
pnpm install
pnpm run dev
```

Do not use Corepack or a global pnpm. `mise install` provides the pinned pnpm, and
`pmOnFail: error` stops any other pnpm version. `STACK.md → 1. Language & Runtime` lists the
versions and the files that mirror them.

- Client runs on `http://localhost:5173`
- Server runs on `http://localhost:3000`
- Vite proxies `/api` to the server in development.

## Quality Gates

There is no remote CI for this repository. Every contributor MUST run the full local gate
before committing and before opening a PR:

```bash
pnpm test-all
```

This runs type-check, lint, build, tests, and the Sony contract validate + diff steps in
order. Individual stages can also be run while iterating:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

## Sony Contract Tooling (Hardcoded Scope)

Tooling scope today: region `fi`, currency `EUR`, platform `PS5`. The contract bot
captures from the `fi-fi` public storefront. The server requests data with `en-fi`.
The response shapes are identical. No sign-in is required.

```bash
# capture + normalize + validate + diff
pnpm run sony:refresh

# validate canonical manifest against backend assumptions
pnpm run sony:validate

# fail on drift (used as the last gate in `pnpm test-all`)
pnpm run sony:diff -- --ci
```

`sony:refresh` drives a Playwright browser. After a Playwright version bump, install the
matching browser once before the next `sony:refresh`:

```bash
pnpm --filter @psstore/sony-contract-bot exec playwright install chromium
```

## Production build

The project has no production deployment. To run a production build locally:

```bash
pnpm install
pnpm run build
pnpm run start
```

The server serves `client/build` and handles SPA fallback routing.

## Environment Variables

- `PORT` (default: `3000`). The Vite dev proxy in `client/vite.config.ts` targets port
  `3000`. If you change `PORT` in development, change the proxy target too.

The Sony contract values are code constants in `server/src/config/env.ts`. They are not
environment variables. `pnpm run sony:refresh` rotates the persisted-query hashes in that
file.

## Sony GraphQL Contract Update Workflow

1. Run `pnpm run sony:refresh` against the public `fi-fi` storefront.
2. Keep only PS5/EUR relevant operations via built-in scope filtering.
3. Verify with `pnpm run sony:validate` and `pnpm run sony:diff -- --ci`.
