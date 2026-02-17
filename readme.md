# PS Store (Client/Server Monorepo)

## Architecture

- `client/` - Vite + React SPA
- `server/` - Express API + Railway runtime
- `shared/` - shared types, schemas, and utilities

The browser talks only to `/api/*`. The server handles Sony GraphQL requests and normalizes data.

## Development

```bash
npm install
npm run dev
```

- Client runs on `http://localhost:5173`
- Server runs on `http://localhost:3000`
- Vite proxies `/api` to the server in development.

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Sony Contract Tooling (Hardcoded Scope)

Tooling scope is fixed and immutable:
- region: `fi`
- locale: `fi-fi`
- currency: `EUR`
- platform: `PS5`

No sign-in is required.

```bash
# capture + normalize + validate + diff
npm run sony:refresh

# validate canonical manifest against backend assumptions
npm run sony:validate

# fail on drift in CI mode
npm run sony:diff -- --ci
```

## Production / Railway

```bash
npm install
npm run build
npm run start
```

Railway should run the Node server (`npm run start`). In production, Express serves `client/build` and handles SPA fallback routing.

## Environment Variables

- `PORT` (default: `3000`)
- `NODE_ENV` (`development|test|production`)
- `SONY_GRAPHQL_URL` (default: `https://web.np.playstation.com/api/graphql/v1/op`)
- `SONY_CATEGORY_GRID_HASH`
- `SONY_CATEGORY_ID`
- `SONY_OPERATION_NAME`
- `SONY_LOCALE`
- `SONY_RETRY_COUNT`
- `SONY_TIMEOUT_MS`
- `CACHE_TTL_MS`

## Sony GraphQL Contract Update Workflow

1. Run `npm run sony:refresh` against the public fi-fi storefront.
2. Keep only PS5/EUR relevant operations via built-in scope filtering.
3. Verify with `npm run sony:validate` and `npm run sony:diff -- --ci`.
