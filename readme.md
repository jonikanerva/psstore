# PS Store

A fast, utilitarian view of the Finnish PlayStation Store. It shows new, upcoming, and
discounted **PS5 games** in the Finnish store, priced in **EUR** with both the standard and
**PS Plus** price visible — without the carousels, mixed platforms, and non-game products of
`store.playstation.com`. Open the page, see what's new, click out to Sony to buy. No accounts,
no preferences, no tracking.

The backend proxies and normalises Sony's public GraphQL API into a clean REST surface scoped
to PS5 / Finland / EUR; the frontend renders what the backend returns.

## Architecture

- `client/` — Vite + React SPA (TanStack Router, TanStack Query, Tailwind CSS)
- `server/` — `@effect/platform` HttpApi backend on Effect (typed REST + in-memory Effect `Cache`), Railway runtime
- `shared/` — Effect Schema types, schemas, and utilities shared across server and client
- `tools/sony-contract-bot/` — captures and validates Sony's GraphQL contract

The browser talks only to `/api/*`. The server handles Sony GraphQL requests, decodes and
narrows the data at the Schema boundary, and serves the normalised result.

## Development

```bash
pnpm install
pnpm run dev
```

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

Tooling scope is fixed and immutable: region `fi`, locale `fi-fi`, currency `EUR`, platform
`PS5`. No sign-in is required.

```bash
# capture + normalize + validate + diff
pnpm run sony:refresh

# validate canonical manifest against backend assumptions
pnpm run sony:validate

# fail on drift (used as the last gate in `pnpm test-all`)
pnpm run sony:diff -- --ci
```

## Production / Railway

```bash
pnpm install
pnpm run build
pnpm run start
```

Railway runs the Node server (`pnpm run start`). In production the server serves
`client/build` and handles SPA fallback routing.

## Environment Variables

- `PORT` (default: `3000`)
- `NODE_ENV` (`development|test|production`)
- `SONY_GRAPHQL_URL` (default: `https://web.np.playstation.com/api/graphql/v1/op`)
- `SONY_CATEGORY_GRID_HASH`
- `SONY_CATEGORY_ID`
- `SONY_DEALS_CATEGORY_ID`
- `SONY_OPERATION_NAME`
- `SONY_PRODUCT_OPERATION_NAME`
- `SONY_PRODUCT_BY_ID_HASH`
- `SONY_LOCALE`
- `SONY_RETRY_COUNT`
- `SONY_TIMEOUT_MS`
- `CACHE_TTL_MS`

## Sony GraphQL Contract Update Workflow

1. Run `pnpm run sony:refresh` against the public fi-fi storefront.
2. Keep only PS5/EUR relevant operations via built-in scope filtering.
3. Verify with `pnpm run sony:validate` and `pnpm run sony:diff -- --ci`.
