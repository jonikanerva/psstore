# PS Store

A fast, utilitarian view of the Finnish PlayStation Store. It shows new, upcoming,
discounted, and monthly PS Plus **PS5 games** in the Finnish store, priced in **EUR** with both the standard and
**PS Plus** price visible — without the carousels, mixed platforms, and non-game products of
`store.playstation.com`. Open the page, see what's new, click out to Sony to buy. No
preferences, no tracking.

The PURCHASED view shows your own PS5 library. You sign in with your NPSSO token. The
server keeps the token in an HttpOnly cookie for 30 days. Sign out clears the cookie.
`STACK.md` section 2.5 describes the mechanics.

The WISHLIST view shows your own Sony wishlist. It uses the same sign-in. It is read-only: it
shows the same cards as the other views, with the date and the Finnish store prices. The server
reads the prices from the public store, never from your wishlist. The view never changes your wishlist.

The server proxies and normalises Sony's public GraphQL API into a clean REST surface scoped
to PS5 / Finland / EUR; the frontend renders what the server returns.

## Architecture

- `crates/domain/` — the pure store types, invariants, and list rules (no I/O)
- `crates/server/` — the Rust HTTP server (Axum on Tokio): the REST API, the Sony and IGDB
  adapters, an in-memory cache, and the static files of the built SPA
- `contract/openapi.json` — the OpenAPI 3.1 document of the `/api` routes, generated from the
  Rust routes
- `packages/api-client/` — the TypeScript client, generated from the OpenAPI document (types,
  SDK, and Zod validators), with a small handwritten facade
- `web/` — the Vite + React SPA (TanStack Router, TanStack Query, Tailwind CSS). It calls the
  API only through `@psstore/api-client`.
- `tools/sony-contract-bot/` — captures and validates Sony's GraphQL contract
- `docs/contracts/` — the Sony contract (manifest and `sony-constants.json`) and the API examples

The browser talks only to `/api/*`. The server handles Sony GraphQL requests, decodes and
narrows the data at its boundary, and serves the normalised result. Every `/api` error is an
RFC 9457 Problem Details body with a stable `code`.

## Development

Prerequisites: [mise](https://mise.jdx.dev/), [rustup](https://rustup.rs/), and, on macOS,
the Xcode Command Line Tools (`xcode-select --install`; they supply the linker for Rust).
`mise.toml` pins Node, pnpm, Gitleaks, cargo-deny, cargo-nextest, and cargo-shear.
`rust-toolchain.toml` pins Rust.

```bash
mise trust
mise run setup
mise run dev
```

Do not use Corepack or a global pnpm. `mise install` provides the pinned pnpm, and
`pmOnFail: error` stops any other pnpm version. `STACK.md` section 1 lists the versions and
the files that mirror them.

- The web app runs on `http://localhost:5173`.
- The server runs on `http://localhost:3000` (`cargo run`; restart `mise run dev` after a
  server change). It writes readable text log lines in development.
- Vite proxies `/api` to the server in development.

`pnpm dev`, `pnpm start`, `pnpm test-all`, and `pnpm test:live` are aliases of the mise tasks.

## Quality Gates

There is no remote CI for this repository. Every contributor MUST run the full local gate
before committing and before opening a PR:

```bash
mise run verify
```

This runs the format check (rustfmt and Prettier), lint (Clippy, Oxlint, and the TypeScript
type check), the API contract check, the secret scan (Gitleaks), the dependency scans
(`pnpm audit`, `cargo deny`, `cargo shear`), the build, the tests (nextest, the doc tests, and
Vitest), and the Sony contract validate and diff steps, in that order. The dependency scans need
network access to the npm registry, GitHub, and crates.io. `STACK.md` section 14 gives the
thresholds and the triage rules.

Run individual steps while you work:

```bash
mise run format
mise run lint
mise run test
mise run build
```

## API contract

The Rust routes are the source of the API contract. After a change to an `/api` route or a
response type, regenerate the document and the client, and commit both:

```bash
mise run contract:export
mise run contract:generate
```

`mise run contract:check` (part of `verify`) fails when the committed files differ from a fresh
export and generation.

## Sony Contract Tooling (Hardcoded Scope)

Tooling scope today: region `fi`, currency `EUR`, platform `PS5`. The contract bot
captures from the `fi-fi` public storefront. The server requests data with `en-fi`.
The response shapes are identical. No sign-in is required.

```bash
# capture + normalize + validate + diff
mise run sony:refresh

# validate the canonical manifest against the server assumptions
mise run sony:validate

# fail on drift (the last step of `mise run verify`)
mise run sony:diff --ci
```

`sony:refresh` drives a Playwright browser. `mise run setup` installs the matching Chromium.

## Production

Railway deploys each merge to `main` to `https://psstore.calmdonut.com`. `railpack.json` sets
the build: the web build and `cargo build --release --locked --package psstore-server`. The
image contains only the server binary and `web/build`. `STACK.md` section 15 describes the
release, the release checks, and the rollback.

To run the production shape locally:

```bash
mise run build
mise run start
```

The server serves `web/build` from the working directory and handles SPA fallback routing.
`/healthz`, `/readyz`, and `/version` are the operational routes.

## Environment Variables

- `PORT` (default: `3000`). The Vite dev proxy in `web/vite.config.ts` targets port
  `3000`. If you change `PORT` in development, change the proxy target too.

- `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` (optional). They are the Twitch app
  credentials for the IGDB critic score on the game page. Set both to turn the
  score on. When one is missing, the game page shows no score. Never commit the
  values.

- `PSSTORE_LOG_FORMAT` (`json` by default; `text` for readable lines). `mise run dev` sets
  `text`.

The Sony contract values are in `docs/contracts/sony-constants.json`. The server compiles the
file in; they are not environment variables. After `mise run sony:refresh` finds a rotated
persisted-query hash, update the hash in that file.

## Sony GraphQL Contract Update Workflow

1. Run `mise run sony:refresh` against the public `fi-fi` storefront.
2. Keep only PS5/EUR relevant operations via built-in scope filtering.
3. Verify with `mise run sony:validate` and `mise run sony:diff --ci`.
