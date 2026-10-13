# PS Store

A fast, utilitarian view of the Finnish PlayStation Store. It shows new, upcoming,
discounted, and monthly PS Plus **PS5 games** in the Finnish store, priced in **EUR** with both the standard and
**PS Plus** price visible — without the carousels, mixed platforms, and non-game products of
`store.playstation.com`. Open the page, see what's new, click out to Sony to buy. No
preferences, no tracking.

The PURCHASED view shows your own PS5 library. You sign in with your NPSSO token. The
server keeps the token in an HttpOnly cookie for 30 days. Sign out clears the cookie.
`STACK.md` section 14 describes the mechanics.

The WISHLIST view shows your own Sony wishlist. It uses the same sign-in. It is read-only: it
shows the same cards as the other views, with the date and the Finnish store prices. The server
reads the prices from the public store, never from your wishlist. The view never changes your wishlist.

The server proxies and normalises Sony's public GraphQL API into a clean REST surface scoped
to PS5 / Finland / EUR; the frontend renders what the server returns.

## Architecture

- `crates/server/` — Rust HTTP server (Axum on Tokio): the typed REST API, an in-memory cache, and the
  built client
- `web/` — Vite + React SPA (TanStack Router, TanStack Query, Tailwind CSS)
- `shared/` — the TypeScript view of the API contract (Effect Schema) and pure client utilities
- `tools/sony-contract-bot/` — captures and validates Sony's GraphQL contract
- `docs/contracts/` — the Sony contract (manifest and `sony-constants.json`) and the API examples
  that the Rust server and the TypeScript client both test against

The browser talks only to `/api/*`. The server handles Sony GraphQL requests, decodes and
narrows the data at its boundary, and serves the normalised result.

## Development

Prerequisites: [mise](https://mise.jdx.dev/) and, on macOS, the Xcode Command Line Tools
(`xcode-select --install`; they supply the linker for Rust). `mise.toml` pins Node, pnpm,
Gitleaks, cargo-deny, and cargo-audit. `rust-toolchain.toml` pins Rust.

```bash
mise install
pnpm install
pnpm run dev
```

Do not use Corepack or a global pnpm. `mise install` provides the pinned pnpm, and
`pmOnFail: error` stops any other pnpm version. `STACK.md → 1. Language & Runtime` lists the
versions and the files that mirror them.

- Client runs on `http://localhost:5173`
- Server runs on `http://localhost:3000` (`cargo run`; restart `pnpm run dev` after a server change)
- Vite proxies `/api` to the server in development.

## Quality Gates

There is no remote CI for this repository. Every contributor MUST run the full local gate
before committing and before opening a PR:

```bash
pnpm test-all
```

This runs the format check (Prettier and rustfmt), type-check, lint (Oxlint and Clippy), the
secret scan (Gitleaks), the dependency scans (`pnpm audit`, `cargo deny`, `cargo audit`), build,
tests (Vitest and `cargo test`), and the Sony contract validate + diff steps in order. The
dependency scans need network access to the npm registry, GitHub, and crates.io. `STACK.md → 4. Build & verify
commands → Security scans` gives the thresholds and the triage rules.

Individual stages can also be run while iterating:

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

## Production

Railway deploys each merge to `main` to `https://psstore.calmdonut.com`. `railpack.json` sets
the build: the client build and `cargo build --release --locked`. The image contains only the
server binary and `web/build`. `STACK.md → 17` describes the release and the rollback.

To run the production shape locally:

```bash
pnpm install
pnpm run build
pnpm run start
```

The server serves `web/build` from the working directory and handles SPA fallback routing.

## Environment Variables

- `PORT` (default: `3000`). The Vite dev proxy in `web/vite.config.ts` targets port
  `3000`. If you change `PORT` in development, change the proxy target too.

- `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` (optional). They are the Twitch app
  credentials for the IGDB critic score on the game page. Set both to turn the
  score on. When one is missing, the game page shows no score. Never commit the
  values.

The Sony contract values are in `docs/contracts/sony-constants.json`. The server compiles the
file in; they are not environment variables. After `pnpm run sony:refresh` finds a rotated
persisted-query hash, update the hash in that file.

## Sony GraphQL Contract Update Workflow

1. Run `pnpm run sony:refresh` against the public `fi-fi` storefront.
2. Keep only PS5/EUR relevant operations via built-in scope filtering.
3. Verify with `pnpm run sony:validate` and `pnpm run sony:diff -- --ci`.
