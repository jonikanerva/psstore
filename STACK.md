# STACK.md — Rust server + TypeScript client profile

Policy revision: 2

> A Rust HTTP server (Axum on Tokio) that serves a typed REST API and the built React + Vite SPA. The client is TypeScript in a pnpm workspace. The Rust compiler and Clippy are the main reviewers: typed errors, exhaustive matches, and explicit ports make most mistakes compile errors. The committed API examples in `docs/contracts/api/` keep the Rust server and the TypeScript client on one contract. **Normative** — MUST / MUST NOT are binding; surface conflicts before deviating.
>
> `DOCTRINE.md` defines P1–P9. `CLAUDE.md` defines agent operation and authority. This file gives their concrete application for this project.

---

## External sources outside the GraphQL contract (critic score)

The game page shows one critic score from IGDB. The server calls `https://api.igdb.com/v4/games` and, for the token, `https://id.twitch.tv/oauth2/token` (Twitch client-credentials). It sends only the public Sony title and the release-year range. It never forwards a cookie, a header, an IP address, or signed-in data. The score is attached to the game page response only (`GameDetail`), never to the list `Game`. The match rule is in `server/src/domain/critic_match.rs`. The score is `aggregated_rating` (critics), never `rating` (users). The drift guard is the golden fixture `server/tests/fixtures/igdbGames.golden.json` (synthetic data) plus the SCORE check in `pnpm test:live`. Without `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` the feature is off and no game page shows a score.

---

## 0. Project shape

- **Project risk rationale:** one owner uses the site as a personal PS5 store view. Railway deploys each merge to `main` (§17). The server has no persisted data, so most failures are recoverable by a fix, a Railway rollback, or a revert. The highest-risk surface is the Sony sign-in: the NPSSO is a full account credential (§14). A leak of the NPSSO cannot be undone by a revert. Upstream drift (Sony GraphQL, the PS Plus feed, IGDB) is the main correctness uncertainty; §4 → Other checks covers it.
- **Change risk:** assess the surfaces that each task affects against this rationale. A change to §14, to logging, or to caching of signed-in data is high risk. A risk label does not waive a required check or review.

- **Shape:** backend service (typed REST with Axum) + React SPA frontend. The server also serves the built SPA.
- **Critical execution path:** the per-request hot path on the server; the browser main thread / React render path on the web.
- **Applicable states:** web surfaces handle awaiting-first-data, success, empty, degraded, offline, error; a surface that needs the Sony sign-in (WISHLIST, PURCHASED) also handles signed-out. API responses are typed success / typed error (each error enum maps to one HTTP status). The server stores no per-user state. The browser keeps only the HttpOnly sign-in cookie (§14).

## Scope boundary

Product scope (from `VISION.md`) is enforced **structurally at the decode boundary, not in the UI**: each source adapter decodes external data with Serde into private raw types and narrows it into domain types before it reaches any other code. Anything outside scope is dropped at the boundary. Signed-in data follows the same rule (for example, the purchased list and the wishlist hold PS5 games only). No user preferences, no server-side per-user state, no telemetry. Per-user data comes only from the Sony sign-in; §14 fixes its mechanics. If a change cannot fit the scope, surface it rather than expanding it.

---

## External sources outside the GraphQL contract

The MONTHLY view reads one other anonymous host: `https://www.playstation.com/bin/imagic/gameslist` with `locale=en-fi` and `categoryList=plus-monthly-games-list`. It returns public JSON. Its response sets a country cookie. The server never stores, forwards, or sends cookies or credentials to it. The Sony contract tooling does not capture this feed. The drift guard is the golden fixture `server/tests/fixtures/plusMonthly.golden.json` plus the MONTHLY count in `pnpm test:live`. Decode and scope it at the boundary like any other external data (`server/src/sources/sony/catalog/monthly.rs`).

---

## 1. Language & Runtime

- **Server language:** Rust 1.99.0, edition 2024, pinned in `rust-toolchain.toml` with rustfmt and Clippy. The minimum supported version (`rust-version` in `server/Cargo.toml`) is 1.99.
- **Server strictness:** `unsafe_code = "forbid"`; Clippy `all` plus `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`, `dbg_macro`, `print_stdout`, `print_stderr`, `as_conversions`, `await_holding_lock`, and `allow_attributes_without_reason` (`[lints]` in `server/Cargo.toml`). `cargo clippy -- -D warnings` makes every lint a failure. Tests may use `unwrap`, `expect`, `panic`, and printing (`clippy.toml`).
- **Client language:** TypeScript 7.x (strict, native compiler). Non-negotiable `tsconfig`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`.
- **Runtime:** the server is a native binary. Production runs it on Railway (Linux, §17). Node.js 24 LTS (24.21.0) runs only the client build, the client tests, and the Sony contract tooling. The production image contains no Node.
- **Package managers and lockfiles:** Cargo with `Cargo.lock` (one workspace: `Cargo.toml` at the root, member `server`). pnpm 12.8.1 (workspaces: `client`, `shared`, `tools/*`) with `pnpm-lock.yaml`.
- **Toolchain bootstrap:** `mise install` provisions Node, pnpm, Gitleaks, cargo-deny, and cargo-audit from `mise.toml`, and the Rust toolchain from `rust-toolchain.toml` (mise reads it as an idiomatic version file). `mise.toml` is the source of truth for every tool except Rust. Change the mirrors in the same commit: `.nvmrc` and `engines.node` (the floor) in the root `package.json` for Node, `packageManager` in the root `package.json` for pnpm, and the `packages` of `railpack.json` for Node and pnpm (§17). Gitleaks, cargo-deny, and cargo-audit have no mirror. `pmOnFail: error` in `pnpm-workspace.yaml` fails a pnpm version mismatch. Keep `mise.toml` to `[settings]` (the Rust idiomatic file) and `[tools]` only.

---

## 2. Frameworks

| Concern           | Technology                                                    | Role                                                                                                        |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| HTTP server       | Axum on a current-thread Tokio runtime                        | Routes, extractors, and responses; thin handlers                                                            |
| Outbound HTTP     | Reqwest with Rustls                                           | Sony, the PS Plus feed, IGDB, and Twitch; timeouts and bounded retries in `server/src/sources/transport.rs` |
| Decoding          | Serde and serde_json                                          | Decode external data into private raw types, then narrow into domain types                                  |
| Time              | Jiff                                                          | Instants and their ISO-8601 form (§12)                                                                      |
| Server cache      | `TtlCache` (`server/src/application/cache.rs`)                | In memory; capacity, a time to live per outcome, one shared lookup per key; testable with a paused clock    |
| Static files      | tower-http `ServeDir`                                         | The built SPA, with the fallback rules in `server/src/http/static_files.rs`                                 |
| Diagnostics       | tracing with the allowlist JSON layer                         | One JSON object per event; only allowlisted fields (§9)                                                     |
| Frontend UI       | React 19 + Vite                                               | Foundation; function components only                                                                        |
| Client validation | Effect Schema (`effect/Schema`) in `shared/` and the client   | The TypeScript view of the API contract and URL parameter decoding                                          |
| Routing           | TanStack Router (SPA); TanStack Start only if SSR is required | Type-safe routing                                                                                           |
| Client cache      | TanStack Query                                                | TTL, background refetch, persisted to `localStorage`/IndexedDB via the official persister                   |
| Styling           | Tailwind CSS v4                                               | Utilitarian; no decorative chrome                                                                           |
| Tests             | `cargo test` (server), Vitest (client, shared, tooling)       | Pure functions, fake ports, local mock servers                                                              |
| Lint              | Clippy (server); Oxlint + tsgolint (TypeScript)               | Warnings are failures                                                                                       |

### Server conventions (binding)

- **Functional core, imperative shell.** `server/src/domain/` holds pure types and transformations. It does not use HTTP, the async runtime, environment access, ambient time, or another module of the crate; the test `domain_has_no_forbidden_dependencies` enforces this. I/O lives in `sources/` (adapters) and `http/` (the interface).
- **Dependency direction:** `http` → `application` → `domain`. `sources` implements the ports of `application` and uses `domain` types. `wiring.rs` is the composition root: the only place that selects a concrete service. Introduce a trait only at a real replaceable or testable boundary.
- **Errors are values.** A fallible operation returns `Result` with a typed error enum. No `panic!`, `unwrap`, or `expect` outside tests. Each error variant maps to one HTTP status in `server/src/http/errors.rs`, so a new variant is a compile error until the mapping handles it. No hand-written status codes in handlers for typed failures.
- **The compiler is the reviewer.** Prefer designs where a mistake is a compile error: newtypes for validated values (`GenreKey`, `CriticScore`, `Secret`), exhaustive `match`, no `as` casts (use `From`/`TryFrom`), and no `#[allow]` without a `reason`.
- **External data is untrusted until decoded.** Decode with Serde into private raw types at the source boundary, then narrow. A missing or invalid value never becomes an invented value.
- **Handlers are thin:** validate the input (`server/src/http/params.rs`), call one service, and return its typed outcome.
- **Contain panics.** A panic in request handling becomes an empty 500; a panic in a cache lookup becomes an upstream failure that is not cached. The panic hook logs only the source location.

---

## 3. Best practices source (Context7 documentation protocol)

**Hard rule: never write or modify code that uses a package or crate in §7 from memory. Retrieve version-pinned docs first** (the `find-docs` skill or the Context7 MCP).

**Tools.** Use the Context7 MCP tools when the session or the agent has them. Otherwise use the `ctx7` CLI through Bash: `npx ctx7@latest library "<name>" "<question>"`, then `npx ctx7@latest docs <libraryId> "<question>"`. For a crate, the pinned source in `~/.cargo/registry/src/index.crates.io-*/<crate>-<version>/` is the authority for the exact version; docs.rs serves the same version. For browser semantics and accessibility (§13), use MDN and the W3C WCAG 2.2 pages through WebFetch. `architect` and `ux-guardian` cite the doc section in each verdict that depends on an API or guideline detail.

1. **Resolve, don't guess.** If a Context7 ID in §7 fails to resolve, use Context7's library-id resolver and take the canonical ID it returns. Never invent an API without resolved docs backing it.
2. **Pin the version in the query.** Axum 0.8 changed the path syntax (`/{id}`, not `/:id`); Reqwest 0.13 moved query and form support behind features. For Effect (client and `shared/` only), target the v4 docs: the Context7 IDs are `/effect-ts/effect` (the `effect_4.0.0-rc.112` version) and `/websites/effect_website_v4`. Context7 has no 4.0.0 corpus; the pinned source is the installed package: `node_modules/effect/ai-docs/**` and the `.d.ts` files of `effect` 4.0.0.
3. **Targeted queries only.** Ask the question for the task at hand; do not retrieve whole documents speculatively.
4. **Retrieve before integrating, not just before calling.** The riskiest code is the glue _between_ packages (for example a tower-http service inside an Axum fallback). When per-package docs don't cover a seam, retrieve both sides.

---

## 4. Build & verify commands

| Variable      | Command                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `$FORMAT_CMD` | `pnpm format` (Prettier and rustfmt)                                                                                                      |
| `$LINT_CMD`   | `pnpm lint` (Oxlint, type-aware, and Clippy with `-D warnings`; the gates below fail the build, not warn)                                 |
| `$BUILD_CMD`  | `pnpm build` (the TypeScript packages, the client build, and `cargo build --release --locked`)                                            |
| `$TEST_CMD`   | `pnpm test` (Vitest and `cargo test --locked`)                                                                                            |
| `$VERIFY_CMD` | `pnpm test-all` (format check → type-check → lint → `scan:secrets` → `scan:deps` → build → tests → `sony:validate` → `sony:diff -- --ci`) |

The `package.json` scripts are the single source of truth. The `rust:*` scripts hold the Cargo commands. Never invoke `tsc`, `oxlint`, `vitest`, `vite`, or `cargo` directly from commits, CI, or agent scripts. A Cargo command during development is fine.

**Narrow test selectors** (for the mutation check): `pnpm --filter <workspace package> test <test file>` for TypeScript, for example `pnpm --filter @psstore/shared test src/__tests__/sortGames.test.ts`; `cargo test --locked -p psstore-server <test name filter>` for the server.

### Security scans

`$VERIFY_CMD` runs these security scans. A finding fails the run.

- **Secret scan:** `pnpm scan:secrets` runs Gitleaks (§7) on the Git history that `HEAD` reaches (`git log -p --full-history HEAD`). Other local branches do not change the result. The scan reads commits only, so uncommitted files and the ignored `.env` file are out of scope. Threshold: any finding. `--redact` keeps secret values out of the output (§9). `pnpm scan:secrets -v` also shows the rule, the file, and the fingerprint of each finding.
- **Secret rules:** `scan:secrets` passes `--config .gitleaks.toml`, so a `GITLEAKS_CONFIG` environment variable cannot replace the rules. `.gitleaks.toml` keeps the Gitleaks default rules and adds the rule `sony-npsso`, because no default rule detects the NPSSO. `sony-npsso` matches a name that contains `npsso` in any case, then optional letters, digits, `_`, or `-`, then an optional quote and optional white space, then one separator (`:`, `=`, `(`, or `,`), then the value. Only white space and one quote can come between the separator and the value. The value has exactly 64 characters from the cookie-safe set of §14, and its first and last characters are letters or digits. Examples: `npsso=…`, `SONY_NPSSO=…`, `"npsso": "…"`, `const npsso = '…'`, `let npsso = "…"`, `exchangeNpsso('…')`, `set('npsso', '…')`. psn-api documents the length. The character set is an assumption.
- **Known gaps of `sony-npsso`:** the rule misses every other form. Examples: a wrapped value such as `Secret::new("…")` (the server tests use this form), a type annotation such as `let npsso: &str = "…"`, a property path such as `config.npsso.value = '…'`, another operator such as `??=`, a value without an `npsso` name such as a bare JSON value, a value that starts or ends with `.`, `_`, `~`, or `-`, and a value of another length. §14 → Fixtures and the reviewer's diff check cover these gaps.
- **Dependency scans:** `pnpm scan:deps` runs `pnpm audit --audit-level low` on all resolved npm dependencies (`dependencies`, `devDependencies`, and `optionalDependencies`), then `cargo deny --locked check bans licenses sources` with `deny.toml` (permissive licences only, crates.io only, no wildcard versions), then `cargo audit --deny warnings` on `Cargo.lock` (RustSec advisories, including unmaintained and yanked crates). Threshold: an advisory of any severity. Development dependencies are in scope because they run on the machine where the owner uses the NPSSO (§0, §14).
- **Network and time:** `pnpm audit` sends the resolved package names and versions to `registry.npmjs.org`. `cargo audit` fetches the RustSec advisory database from GitHub and reads the crates.io index. A registry or fetch error fails the scan. The advisory data changes over time, so an unchanged commit can fail when a new advisory appears. Record the time of the run in the PR evidence.

Triage a finding with these rules:

1. **Real secret:** treat the secret as leaked. Revoke or rotate it first. For the NPSSO, sign out of Sony (§17). Then remove it from the change. A secret in pushed history stays leaked after its removal. Never put a real secret on an ignore list.
2. **False-positive secret:** on a line in a new commit, add a `gitleaks:allow` comment with the reason. For a commit that is already on `main`, add the finding fingerprint to `.gitleaksignore` with a comment that gives the reason. A fingerprint names one commit, file, rule, and line, so a later change to that line gives a new finding for a new triage.
3. **Advisory with a fix:** update the affected package to a patched version, for example `pnpm update -r <package>` or `cargo update -p <crate> --precise <version>`. Keep the lockfile diff to the affected packages. When a direct dependency pins the vulnerable version, update that dependency within its major version. A fix that needs a new major version or a new package is a dependency change under §7 and P2.
4. **Advisory without a usable fix:** for npm, add its GHSA id to `audit.ignore` in `pnpm-workspace.yaml` with a comment; for a crate, add its RUSTSEC id to `[advisories] ignore` in `deny.toml` and to an `audit.toml` ignore list with a comment. Record a scoped exception in §15 with the reason, the compensating evidence, the independent reviewer, and a reassessment condition.

Never pass a scan by `--ignore-registry-errors`, `--ignore-unfixable`, `--prod`, a higher `--audit-level`, a removed `--deny warnings`, a wider `deny.toml` licence or source list, a Gitleaks allowlist that is wider than one finding, or a removed or weaker rule in `.gitleaks.toml`. A change to the threshold, the rules, or the scope of a scan changes an acceptance gate and needs independent review.

### Other checks

`$VERIFY_CMD` checks the Sony boundary against committed fixtures only. It does not reach live Sony. The checks below do. `docs/contracts/sony-graphql-runbook.md` is the reference for each.

| Check                       | Trigger                                                                                                                                                                                                                                                   | Who runs it                                                                                                                                                                                                                                              | Evidence in the PR                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:live`            | The diff touches `server/src/sources/sony/**` (except the signed-in client), `server/src/sources/igdb/**`, `server/src/domain/**`, `server/src/application/games.rs`, `server/src/application/critic_scores.rs`, or `docs/contracts/sony-constants.json`. | The PR author (`lead-dev`), on the pushed head. The SCORE checks need the owner's `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`: load only these two variables from the main checkout's `.env` and never print them (owner decision on PR #155, 2026-10-06). | The per-feature counts (NEW / UPCOMING / DISCOUNTED / MONTHLY / GENRES / BROWSE / SEARCH), the resolved PDP SKU, the SCORE control hit count, and the SCORE hit count of the NEW sample. A PR without them fails review. |
| `pnpm sony:refresh`         | No diff trigger. The owner runs it weekly. A persisted-query hash rotation also needs it (runbook → Failure handling).                                                                                                                                    | Owner-run. An agent runs it only when the owner asks in the current task or the task is a hash-rotation fix.                                                                                                                                             | On drift: the refreshed `docs/contracts/sony-graphql-manifest.json` and the hashes in `docs/contracts/sony-constants.json`.                                                                                              |
| `pnpm sony:probe-purchased` | The diff touches the signed-in flow (§14), the signed-in Sony client (`server/src/sources/sony/account.rs` and its submodules), or the `SONY_AUTH_*` or `SONY_PURCHASED_*` keys of `docs/contracts/sony-constants.json`.                                  | Owner-run only. The owner supplies a real NPSSO in `SONY_NPSSO`, never committed. An agent never runs it.                                                                                                                                                | `triggered, pending owner run`, or `ran on <SHA>: PASS`. On PASS the manifest records `observed_status_codes: [200]` for `purchased`.                                                                                    |
| `pnpm sony:probe-wishlist`  | The diff touches the signed-in flow (§14), the signed-in Sony client, or the `SONY_AUTH_*` or `SONY_WISHLIST_*` keys of `docs/contracts/sony-constants.json`.                                                                                             | Owner-run only. The owner supplies a real NPSSO in `SONY_NPSSO`, never committed. An agent never runs it.                                                                                                                                                | `triggered, pending owner run`, or `ran on <SHA>: PASS`. On PASS the manifest records `observed_status_codes: [200]` for `wishlist`.                                                                                     |
| API parity                  | A change that can alter `/api` responses: a server change outside tests and docs.                                                                                                                                                                         | The PR author: run the local branch server and production (`https://psstore.calmdonut.com`), or two local builds, through `cargo run --locked --example api_parity -- <base A> <base B>`.                                                                | The summary and every explained difference. A difference that the change does not intend fails review.                                                                                                                   |

Never schedule or automate any of these checks (§10).

**Signed-in Sony flow.** A live check or a contract capture of the sign-in exchange or of a signed-in Sony operation needs a real NPSSO. Both are owner-run: the owner supplies their own NPSSO through an environment variable that is never committed. Agents never hold a real NPSSO or access token. When a diff touches the signed-in flow, list the live check in the PR as `triggered, pending owner run`, or `ran on <SHA>: PASS`.

---

## 5. Performance budgets

TBD. Let's aim for fast. The owner set no memory budget for the Rust server (2026-10-13, ADR 0003). Railway's memory metric shows the use after a release.

---

## 6. Persistence shape

- **Server:** in-memory `TtlCache` only (§2) — TTL built in, no manual invalidation. **No database, no on-disk persistence, no per-visitor state.** Purchased-games and wishlist requests and the sign-in exchange bypass the cache (§14). The public per-game lookups that fill wishlist cards use it.
- **Client:** TanStack Query cache persisted to `localStorage`/IndexedDB via the official persister, for anonymous store queries only. Signed-in responses live in memory only. **No per-user value is persisted by script.** The one per-user value the browser keeps is the HttpOnly NPSSO cookie (§14), which JavaScript cannot read.
- **Persisted entities:** declared by `VISION.md → Persistence and Privacy Posture`.
- **Forbidden persistence:** accounts, user preferences, per-user state, telemetry, and anything forbidden in `VISION.md → Persistence and Privacy Posture`.

---

## 7. Approved dependencies

Default answer to "should we add a library?" is **no**. Track the latest **stable** version; pin exact versions; upgrade deliberately, not by drift. The server crates are pinned with `=x.y.z` in `server/Cargo.toml` and resolved in `Cargo.lock`. Enable only the features that the code uses. **Effect is on v4** (4.0.0) in the client and `shared/` only. Pin the Effect family by hand to exact versions. Never use `pnpm update --latest`, `-L`, or `@latest` on the Effect family.

**Server crates** (`server/Cargo.toml`):

| Crate                              | Version              | Documentation (pinned version)                         | Why it earns its place                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axum`                             | `0.8.9`              | docs.rs `axum/0.8.9`                                   | HTTP routing and extractors on Tokio and Hyper. Features: `http1`, `json`, `matched-path`, `tokio`. The same version as `commute`.                                                                                                                                                                                                |
| `tokio`                            | `1.53.2`             | docs.rs `tokio/1.53.2`                                 | Async runtime (current-thread), timers, signals, file access for static files. `test-util` in tests pauses the clock.                                                                                                                                                                                                             |
| `reqwest`                          | `0.13.5`             | docs.rs `reqwest/0.13.5`                               | Outbound HTTPS with Rustls, gzip, query, and form support. Connection pools and the redirect policy per client.                                                                                                                                                                                                                   |
| `serde`, `serde_json`              | `1.0.229`, `1.0.151` | docs.rs `serde`, `serde_json`                          | Decoding of external JSON into raw types; the JSON of the API.                                                                                                                                                                                                                                                                    |
| `jiff`                             | `0.2.38`             | docs.rs `jiff/0.2.38`                                  | Instants and their ISO-8601 parse and format (§12). No time zone database: the server works in UTC.                                                                                                                                                                                                                               |
| `tower`, `tower-http`              | `0.5.3`, `0.6.11`    | docs.rs `tower`, `tower-http`                          | `ServeDir` for the built SPA (path traversal protection, `Last-Modified`, ranges) and the trailing-slash request mapping. Reqwest already depends on `tower-http` 0.6.11.                                                                                                                                                         |
| `futures-util`                     | `0.3.34`             | docs.rs `futures-util/0.3.34`                          | Shared futures for the cache and the in-flight exchange; `catch_unwind` for panic containment. Axum and Hyper already depend on it.                                                                                                                                                                                               |
| `form_urlencoded`                  | `1.2.2`              | docs.rs `form_urlencoded/1.2.2`                        | Query decoding with the semantics of `URLSearchParams` (repeated keys stay visible, §4 → parameter rules in `server/src/http/params.rs`). Already in the graph through `url`.                                                                                                                                                     |
| `tracing`, `tracing-subscriber`    | `0.1.44`, `0.3.23`   | docs.rs `tracing`, `tracing-subscriber`                | Structured events and the allowlist JSON layer (§9). Registry only, no formatting layer.                                                                                                                                                                                                                                          |
| `icu_normalizer`, `icu_properties` | `2.3.0`, `2.3.0`     | docs.rs `icu_normalizer/2.3.0`, `icu_properties/2.3.0` | The critic match rule (`server/src/domain/critic_match.rs`): NFKD normalisation and the exact Unicode general categories `\p{L}` and `\p{N}`, like JavaScript `normalize('NFKD')` and `/[^\p{L}\p{N}]/u`. Feature `compiled_data` only. Already in the graph through `url` → `idna`, so they add no package. Unicode-3.0 licence. |

**Client and tooling packages:**

| Dependency                          | Version                                   | Context7 ID                                        | Why it earns its place                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect` (Schema)                   | `4.0.0`                                   | `/effect-ts/effect`, `/websites/effect_website_v4` | The TypeScript view of the API contract in `shared/` and URL parameter decoding in the client                                                                                                                            |
| `typescript`                        | `7.x`                                     | `/microsoft/typescript`                            | Client and tooling language                                                                                                                                                                                              |
| `react`                             | `19.x`                                    | `/facebook/react`                                  | Frontend UI                                                                                                                                                                                                              |
| `vite`                              | latest                                    | `/vitejs/vite`                                     | Frontend build tool                                                                                                                                                                                                      |
| `@tanstack/react-router` (+ Start)  | `1.x`                                     | `/tanstack/router`                                 | Type-safe routing                                                                                                                                                                                                        |
| `@tanstack/react-query`             | `5.x`                                     | `/tanstack/query`                                  | Client cache                                                                                                                                                                                                             |
| `tailwindcss`                       | `4.x`                                     | `/tailwindlabs/tailwindcss`                        | Utilitarian styling                                                                                                                                                                                                      |
| `vitest`                            | latest                                    | `/vitest-dev/vitest`                               | Test runner                                                                                                                                                                                                              |
| `oxlint`                            | latest                                    | `/oxc-project/oxc`                                 | Linter. Reads `.oxlintrc.json`. Approved user 2026-10-02.                                                                                                                                                                |
| `oxlint-tsgolint`                   | latest                                    | `/oxc-project/tsgolint`                            | Type-aware lint rules. Bundles its own typescript-go, so the lint does not depend on the `typescript` package version. Approved user 2026-10-02.                                                                         |
| `pnpm`                              | `12.8.1` (`mise.toml` + `packageManager`) | `/pnpm/pnpm`                                       | Package manager (runtime: Node 24 LTS, `/nodejs/node`)                                                                                                                                                                   |
| Gitleaks (mise, no package)         | `8.30.1` (`mise.toml`)                    | `/gitleaks/gitleaks`                               | Secret scan in `$VERIFY_CMD` (§4 → Security scans). One local binary, no network calls. MIT. TruffleHog (AGPL-3.0) and detect-secrets (Python) rejected. Approved owner (issue #146) 2026-10-04.                         |
| cargo-deny (mise, no package)       | `0.20.2` (`mise.toml`)                    | embarkstudios.github.io/cargo-deny                 | Licences, sources, and bans of the server crates (§4 → Security scans). The same version as `commute`. Lead choice within the port to Rust (issue #157), 2026-10-13.                                                     |
| cargo-audit (mise, no package)      | `0.22.2` (`mise.toml`)                    | docs.rs `cargo-audit/0.22.2`                       | RustSec advisories of `Cargo.lock` (§4 → Security scans). mise builds it from source. The same version as `commute`. Lead choice within the port to Rust (issue #157), 2026-10-13.                                       |
| IGDB (external service, no package) | API v4                                    | `/websites/api-docs_igdb`                          | Critic score on the game page (`aggregated_rating`). Hosts: `api.igdb.com` and `id.twitch.tv`. Server-side only; credentials from the environment (`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`). Approved pm/team 2026-10-03. |
| `dompurify`                         | `3.4.16`                                  | `/cure53/dompurify`                                | Client XSS control: sanitizes Sony-authored description HTML before `dangerouslySetInnerHTML` (`GameDetailsPage.tsx`). No platform equivalent. Approved pm/team 2026-05-31.                                              |
| `luxon`                             | `3.7.2`                                   | `/moment/luxon`                                    | Client ISO date parse + localized formatting (`GameCard.tsx`, `GameDetailsPage.tsx`). Kept; an `Intl.DateTimeFormat` swap is a deferred follow-up, not this change. Approved pm/team 2026-05-31.                         |
| `@types/luxon`                      | `3.7.6`                                   | `/moment/luxon`                                    | Type definitions for `luxon`. Client devDependency only (de-duplicated from the root in this change). Approved pm/team 2026-05-31.                                                                                       |

The lead chose the server crates within the port to Rust that the owner decided (issue #157, ADR 0003, 2026-10-13); an ordinary library choice is a delegated decision (`DOCTRINE.md` P2). New entries require a `STACK.md` PR with rationale, approver, and date. A new crate also needs a `cargo deny` pass; record its licence, its maintenance state, and whether it adds a build script or a proc-macro crate (§17 → build-time variables).

**Shared versions.** The `catalog:` block in `pnpm-workspace.yaml` is the single version source for any npm dependency that more than one workspace manifest declares. Manifests reference it with the `catalog:` specifier. Pins stay exact where this table pins them exactly.

**Lint tooling.** `.oxlintrc.json` is the single TypeScript lint config. Clippy reads the `[lints]` of `server/Cargo.toml` and `clippy.toml`.

**Tooling (not product runtime deps):** `playwright@1.63.0` is a devDependency of the Sony contract bot (`tools/sony-contract-bot`) used to capture the GraphQL contract during `pnpm sony:refresh`. It never ships in the server or client runtime and is intentionally excluded from the product-dependency table above.
mise is the toolchain bootstrap (§1), not a package dependency. Approved user/pm 2026-10-02.

---

## 8. Stack-specific reject-list additions

Server (Rust):

- **`unsafe`** — forbidden by the crate lints.
- **`unwrap`, `expect`, `panic!`, `todo!`, `unimplemented!`, `dbg!`, `println!`, `eprintln!` outside tests** — Clippy denies them. Return a typed error; log with `tracing` (§9).
- **`as` casts** — use `From`/`TryFrom` or a checked conversion. An unavoidable float cast needs `#[allow(clippy::as_conversions, reason = "…")]`.
- **`#[allow]` without a `reason`** — name the underlying constraint.
- **I/O, the async runtime, environment access, or ambient time in `server/src/domain/`** — the boundary test fails.
- **Untyped external data** (`serde_json::Value`) past the source boundary — decode into raw types and narrow.
- **A `reqwest` error text in a message, a log, or a response** — it can contain a URL. Map it to a fixed message.
- **`sort_unstable` where the order of equal items is visible** — the API order is part of the contract.
- **Hand-rolled status codes for typed failures in handlers** — map each error enum in `server/src/http/errors.rs`.

Client and tooling (TypeScript):

- **`any`** — explicit or implicit. `no-explicit-any` and `no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-member-access` are **CI gates (build fails, not warns)**.
- **`as` casts** that bypass type checking — use `satisfies` or a runtime/Schema guard.
- **`// @ts-ignore` / `// @ts-expect-error`** without an inline reason naming the underlying constraint.
- **`console.*` in shipped code.**
- **Class-based React components**; **`useEffect` for data fetching** — use TanStack Query.
- **Effect v3 APIs** (for example `Context.Tag`, `Either`, `Schema.optionalWith`, `@effect/platform`) and **`@stability unstable` Effect modules**. Both need an intentional migration and a §15 row.

Both:

- **Writing package or crate code from memory** without the §3 retrieval.
- **Local-time instants or hand-rolled UTC-offset arithmetic**, and new ambient wall-clock reads in server domain or application code — see §12.
- **A second critic or review provider, a user rating or review, a call to IGDB from the browser, or critic data on the list `Game` type.** One provider, server-side, game page only.
- **A Sony credential or per-user data outside its allowed path** — see §14. The NPSSO is allowed only in the HttpOnly sign-in cookie and in the body of the sign-in request. Still banned: the NPSSO in any cookie that JavaScript can read, in `localStorage`, `sessionStorage`, IndexedDB, a URL, a log, a cache, or a committed file; the access token anywhere it is persisted or returned to the client; a server-side session store; a kept refresh token; and an account identifier or signed-in response data in any cache, storage, log, URL, or committed file.

---

## 9. Logging & privacy

- **Logger:** `tracing` events through the allowlist JSON layer (`server/src/observability.rs`). The layer writes one JSON object per event to standard output and keeps only the fields in `ALLOWED_FIELDS`; it drops every other field value and lists only the dropped field names. It ignores events from other crates, because their text can contain URLs. An event message is a fixed text. Each request writes one line with the route pattern, the method, the status, and the elapsed time — never the path, the query, a header, or a body, because a search term or a game id is user input. Never `console.*` in shipped client code. Add a field to `ALLOWED_FIELDS` only when every value is free of data by construction (a tag, a count, a route pattern, an operation name).
- **No PII / no telemetry.**
- **Language:** everything the user sees is in English: UI chrome (labels, placeholders, error states), Sony game data, and formatted dates. Request Sony data from the Finnish store (EUR) in English. The content language is a fixed constant (`SONY_LOCALE` in `docs/contracts/sony-constants.json`, `en-fi`), never a switcher, a stored choice, or a value derived from the browser. Region (Finland, EUR) and content language (English) are separate. Sony request tag: `en-fi` (sent as `en-FI` in the locale override header). Formatted dates: `en-GB`, passed explicitly to luxon. Prices stay Sony's verbatim strings (decimal comma, no reformatting).
- **Critic score credentials:** the server types the Twitch client secret and the access token as `Secret` (`server/src/domain/secret.rs`): its `Debug` output is `<redacted>`, and it has no `Display` and no `Serialize`. Never log the client secret, the token, the `Client-ID` header, the `Authorization` header, or the token request body. A failed lookup logs only its error tag. The credentials go in the token request form body, never in a URL.
- **Sony credentials:** the server types the NPSSO and the access token as `Secret` (§14). The cookie value is the NPSSO: never log the `Cookie` header or the `Set-Cookie` header, the `Location` header of the Sony authorize redirect, the headers or the body of a sign-in or signed-in request, an account identifier, or signed-in response data. A failed account request logs only its error tag.
- **Panics:** the panic hook logs only the source location of a panic, never its message, because a message can contain data.
- **Crash / error reporter:** none by default; if added, declare it in §7 with data-flow justification.

---

## 10. Background & lifecycle

- **Allowed:** TTL-bounded cache refresh driven by request access (`TtlCache`). A cache lookup runs to its end as its own task also when the request that started it ends, so it fills the cache; it is still bounded by its timeouts. The client tab prefetch: once per page load, one request at a time, only while no other fetch is active (§14 → Prefetch).
- **Forbidden:** background polling or long-lived connections without active user interaction; any background work that retains data forbidden by `VISION.md`; background session refresh; background refetch of signed-in data, except the one prefetch per page load. The client refetches the signed-in list on a user action, or in that prefetch.
- **Shutdown:** on SIGTERM or SIGINT the server stops accepting connections and gives active requests 35 seconds (the purchased crawl has a 30-second deadline).

---

## 11. Definition-of-done additions

On top of `DOCTRINE.md` P3 and P6, this stack also requires: rustfmt and Clippy with zero warnings; `tsc` zero errors; Oxlint zero errors and zero warnings (the §8 `no-any` / `no-unsafe-*` gates); no I/O, runtime, environment, or ambient time in `server/src/domain/`; no panic path outside tests; any new package or crate usage grounded in §3 version-pinned docs; the API examples in `docs/contracts/api/` updated with any change to an API payload; and no NPSSO outside the HttpOnly cookie and the sign-in request body, and no access token or signed-in data in a log, cache, persisted storage, or committed file (§14). The compiler and this checklist are the review — design code so the checklist _can_ catch mistakes.

---

## 12. Time & timezones

UTC everywhere internally. Convert only at the boundary (`DOCTRINE.md` P5). This section pins the mechanics.

- **Internal representation:** an instant is a UTC ISO-8601 string with a `Z` suffix (for example `Game.date`), or a Jiff `Timestamp` / epoch milliseconds for a comparison. A value with an implicit local offset is forbidden. A missing or unparseable upstream date maps to the empty string, never to a guessed instant.
- **Inbound boundary (server):** the Sony mapper (`server/src/domain/mapper.rs`, with the JavaScript date rules in `server/src/domain/js.rs`) normalises each upstream date to UTC like the TypeScript server it replaced: `Date.parse`, then `toISOString()`, which prints milliseconds. Some card sources pass Sony's date through unchanged (NEW and search cards carry `…T21:00:00Z`; MONTHLY and BROWSE cards carry `….000Z`). The tests pin each date path.
- **Wire:** the API contract carries the UTC string unchanged.
- **Outbound boundary (client):** only the rendering component converts an instant to a local date: luxon `DateTime.fromISO(value)`, then `toLocaleString(DateTime.DATE_MED)` with the explicit locale `en-GB` (§9): `toLocaleString(DateTime.DATE_MED, { locale: 'en-GB' })`. The result uses the viewer's system timezone.
- **NEW / UPCOMING day split:** the split is at the viewer's next local midnight (`docs/adr/0001-new-upcoming-day-split.md`). The server never receives the viewer's time zone. It sends each list a UTC superset: NEW ends at `now + 37 h`, UPCOMING starts at `now - 12 h`. The rendering component (`Games.tsx`, through `client/src/modules/releaseDay.ts`) computes the next local midnight with luxon and keeps each game in one list.
- **Current instant:** server code reads it through the injected `Clock` (`server/src/application/clock.rs`). A pure function takes it as a parameter. Deadlines, timeouts, and cache expiry use `tokio::time`.
- **Tests:** drive time-dependent server logic with `FixedClock` and `#[tokio::test(start_paused = true)]`. Do not assert on a string that depends on the timezone of the test machine.
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

`VISION.md → Persistence and Privacy Posture` sets the policy. This section fixes the mechanics for every feature that uses the user's Sony sign-in. WISHLIST and PURCHASED use it. Both are read-only.

- **Credential:** the user pastes their NPSSO token into the sign-in form. Sony offers no public OAuth for third parties. The NPSSO flow is unofficial and undocumented. Treat the NPSSO as a full account credential. The reference for the exchange and for signed-in operations such as the purchased-games list is the `psn-api` documentation (Context7 `/achievements-app/psn-api`). Adding `psn-api` itself as a dependency needs a §7 entry like any other package.
- **Exchange:** the client sends the NPSSO once, in a JSON request body, to `POST /api/session`. The route requires a JSON content type (or none) and answers any other content type with 415; it sends no CORS headers. The backend exchanges the NPSSO with Sony for a short-lived access token. It discards the access token at once. It keeps no refresh token and no id token: the decoder reads only `access_token` and `expires_in`. The response is an empty 204 with no token and no NPSSO in the body. The backend sets the sign-in cookie only after Sony accepted the NPSSO.
- **Cookie:** the cookie is named `npsso`. Its value is the NPSSO. Its attributes are `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000` (30 days). `DELETE /api/session` clears it with the same attributes and `Max-Age=0`. JavaScript cannot read it. The server never forwards, stores, or reads back a Sony `Set-Cookie`. The NPSSO payload is 16 to 512 characters from the cookie-safe set `A-Za-z0-9._~-`. `Secure` cookies work on `http://localhost` in Chrome and Firefox, not in Safari.
- **Client:** the client holds no token and no sign-in state of its own. The signed-in status derives from the `['purchased']` and `['wishlist']` queries: a 401 on either one shows the sign-in form in its view. A sign-in or sign-out resets the query that is not on screen. The reset itself makes no Sony call. The browser attaches the cookie. The client never reads `document.cookie` and never writes the NPSSO to `localStorage`, `sessionStorage`, IndexedDB, a URL, or a query key. The input field is cleared on submit. Both queries refetch on a user action, or in the prefetch below.
- **Prefetch:** after the open tab has loaded, the client fetches the other tabs one at a time, in the order UPCOMING, DISCOUNTED, MONTHLY, WISHLIST, PURCHASED (`usePrefetchTabs`). It skips BROWSE: BROWSE has no list until the user chooses a genre and an order. It fetches the first page of an anonymous tab. It uses the query keys and options of the views. It skips a tab that has data or that a view has open. It starts only after the cache restore ends and while no other fetch is active. A route change, or a fetch that another query starts, aborts the request in flight. The prefetch resumes when no other fetch is active. It never aborts a request that a view has joined. The HttpOnly cookie is unreadable, so the client cannot test the sign-in state. It requests WISHLIST and PURCHASED and accepts the answer. A 401 is silent: no sign-in form, no error, no entry in the cache. A 401 ends the signed-in prefetch for the page session. Any other failure ends all prefetch for the page session, with no retry. A sign-out aborts a signed-in request in flight and ends the signed-in prefetch. Signed-in answers stay in memory (Caching). The prefetch logs no signed-in data.
- **Requests:** the browser sends the cookie to `/api` routes. A signed-in route reads the first `npsso` cookie of the request (`server/src/http/session.rs`). A missing or empty cookie is a 401 with no Sony call. The backend exchanges the NPSSO for a new access token on each request, forwards the token to Sony, and returns the decoded result. Concurrent requests with the same NPSSO share one in-flight exchange (`InFlight` in `server/src/application/in_flight.rs`, keyed by the `Secret` value, no idle time-to-live). The shared entry ends when the exchange ends, before the library crawl. No access token is kept after that. There is no server session store.
- **Server types:** the NPSSO and the Sony access token are `Secret` values from the moment they are read. Read the raw value with `Secret::expose` only where it goes into an outbound Sony request and into the sign-in cookie.
- **Caching:** the sign-in exchange and the signed-in Sony responses never use the `TtlCache`, and no access token is retained between requests. Only the in-flight sharing in Requests is allowed. The wishlist route also calls the anonymous public lookups of the games service. Those lookups cache public store data by public product id. No account value is in a key or a value. On the client, the persister allow-list (`shouldDehydrateQuery` in `client/src/modules/persistence.ts`) admits only the anonymous `games` and `game` keys. Never add a signed-in query to the allow-list. Reset the `['purchased']` and `['wishlist']` queries on sign-out. The game page reads these two lists on a 404 only, to show an entry that the public store has no page for. The reset clears the data. Only the open view refetches, and that request gets a 401 with no Sony call.
- **Scope:** decode signed-in responses with Serde and narrow them to the product scope at the boundary, like anonymous data. The purchased list keeps only an entry with platform exactly `PS5`, a non-empty name, and a valid product id. Everything else is dropped. The library crawl reads pages of 100 in sequence. A library of more than 20 pages fails the request with 502 or 503. It is never cut short. The wishlist is one request with no paging. It keeps an entry only when its platforms include `PS5`, its name is not empty, and its id is valid for its `__typename` (a product id for `Product`, a concept id for `Concept`). The wishlist response has no region field, so its price strings are ignored. The server fills each product entry from the anonymous Finnish store lookup that the game page uses (bounded concurrency, a deadline per entry and one for the list). A concept entry, a missing game, or a slow or failed lookup keeps a card with name and image only. A `null` or missing list without a definitive access-denied answer is drift (502). It is never an empty wishlist.
- **Errors:** only a definitive Sony rejection maps to HTTP 401 and clears the cookie. That is an authorize redirect without a code, or a 401 or 403 from the token or library call. A 429 maps to 503. A 5xx, an unexpected answer, or a timeout maps to 502 or 503 and keeps the cookie. The client shows the sign-in form on a 401 only.
- **Contract:** the sign-in exchange and each signed-in operation go through the Sony contract tooling like the anonymous operations. The sign-in constants (`SONY_AUTH_*`), the operation names, and the hashes are in `docs/contracts/sony-constants.json`, which the server compiles in and the probes read. Capture and live checks need a real NPSSO, so the owner runs them (§4 → Other checks). `getPurchasedGameList` and `storeRetrieveWishlist` each have a hand-written synthetic manifest entry. An entry guards the repository-internal name and hash only. It does not detect Sony drift until the owner runs a live check. The server never calls a wishlist write operation.
- **Fixtures:** committed manifests, golden fixtures, and samples never contain a real NPSSO, access token, refresh token, account identifier, or real signed-in response data. Use synthetic values.
- **XSS:** an XSS bug can no longer read the NPSSO cookie, but it can still make requests as the user. Keep DOMPurify on every Sony-authored HTML string. Add no new `dangerouslySetInnerHTML`.

---

## 15. Scoped exceptions and intentional divergences

Do not weaken a rule or a check to make a change pass. The responsible lead resolves an exception within project authority, with an independent reviewer. The change author must not approve their own weaker acceptance or checks. Escalate a change beyond that authority, or an unresolved material risk, to the owner. Record a significant design decision in a short `docs/adr/` file.

### Scoped exceptions

| Rule / scope | Reason and consequences | Compensating evidence | Responsible lead / reviewer / approval | Expiry or reassessment |
| ------------ | ----------------------- | --------------------- | -------------------------------------- | ---------------------- |
| _(none)_     | —                       | —                     | —                                      | —                      |

### Intentional divergences

The owner approved each row below as a permanent project decision. A row has no expiry. Reassess a row when its reason no longer holds.

| Date       | CLAUDE.md rule                                                                 | Divergence                                                                                                                                                                                                                                      | Reason                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | Sony contract tooling scope (readme and runbook: the tooling captures `fi-fi`) | The server requests `en-fi`. The contract bot, the manifest metadata, and the capture routes stay on `fi-fi`.                                                                                                                                   | Structural parity verified live on 2026-10-02: same ids, order, counts, PDP, and prices. The persisted-query hashes do not depend on locale. The manifest operation variable schemas contain no locale key.             |
| 2026-10-03 | `CLAUDE.md` → Privacy & security; `STACK.md` §14 and §8 (previous text)        | The NPSSO persists in an HttpOnly cookie for 30 days, and the server sets a sign-in cookie. The previous §14 forbade both. The server stays stateless and exchanges the NPSSO on every request. A 401 from a signed-in route clears the cookie. | Owner decision (issue #108, 2026-10-03): the user signs in once until Sony expires the NPSSO. The cookie is HttpOnly, Secure, and SameSite=Strict, so script cannot read it and a cross-site request does not carry it. |
| 2026-10-03 | `STACK.md` §10 and §14 (previous text)                                         | The client fetches WISHLIST and PURCHASED once per page load without a click, in the tab prefetch (§14 → Prefetch). The previous text allowed signed-in fetches only on a user action.                                                          | Owner decision (issue #134, 2026-10-03): the other tabs load fast when the user opens them. Cost: a signed-in user triggers up to 2 token exchanges and up to 21 Sony library calls on each page load.                  |

---

## 16. Applicability and evidence

P1–P9 refer to `DOCTRINE.md`. Run the required tests and the full `$VERIFY_CMD` locally on the exact version to merge, integrated with the current `main`. A failed or missing required local check blocks merge. The repository has no CI pipeline. A missing CI pipeline does not block merge. Missing pre-merge evidence blocks merge. Missing post-release evidence blocks a claim of a successful release.

| Doctrine / applicability                  | Required evidence                                                                                                                                                        | Environment / gap to resolve                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1, P6: every task                        | Acceptance criteria, material failure cases, assumptions, and their check mapping in the issue or the PR                                                                 | The lead prepares them. A material change gets an independent review.                                                                                                                                                          |
| P2–P5: changed code and dependencies      | `pnpm test-all` (§4 → `$VERIFY_CMD`). A §7 entry for each new dependency.                                                                                                | Local; Node, pnpm, Gitleaks, cargo-deny, and cargo-audit from `mise.toml`; Rust from `rust-toolchain.toml`.                                                                                                                    |
| P5–P6: changed data boundaries            | Decode and scope tests, golden fixtures, tests for one invalid item among valid items and for a whole-response failure where each can occur                              | Golden fixtures hold synthetic data only (§14 → Fixtures).                                                                                                                                                                     |
| P5–P6: the API contract                   | The examples in `docs/contracts/api/` pass the Rust test and the TypeScript test; API parity (§4 → Other checks) for a server change                                     | The parity run needs network access to Sony.                                                                                                                                                                                   |
| P5–P6: upstream contracts                 | The checks in §4 → Other checks, with their triggers and owners                                                                                                          | `pnpm test:live` needs network access to Sony and IGDB. The owner runs the signed-in probes with a real NPSSO.                                                                                                                 |
| P3, P7: security and dependencies         | `scan:secrets` (Gitleaks) and `scan:deps` (`pnpm audit`, `cargo deny`, `cargo audit`) in `pnpm test-all`. §4 → Security scans gives the thresholds and the triage rules. | `scan:deps` needs `registry.npmjs.org`, GitHub, and crates.io, and its result depends on the time of the run. Known gap: `sony-npsso` misses some NPSSO forms (§4 → Security scans). The reviewer checks the diff for secrets. |
| P5–P7: web surfaces and critical journeys | Vitest tests of the state owners for each applicable §0 state; the WCAG thresholds in §13                                                                                | Known gap: no browser end-to-end test. A material UI change needs a manual check in `pnpm dev`, recorded in the PR.                                                                                                            |
| P7: release and recovery                  | §17                                                                                                                                                                      | The first Linux build of a build change happens on Railway at the merge (§17).                                                                                                                                                 |
| P8–P9: material changes                   | Current docs, a short ADR for a significant durable decision, independent review of the integrated result, explicit limitations                                          | Separate reviewer context. Read ADRs only when they are relevant.                                                                                                                                                              |

---

## 17. Release, recovery, and maintenance

- **Release:** the Railway service `psstore` (project `calmdonut`, environment `production`) deploys each merge to `main`. A merge is a release. Agents call the site at `https://psstore.calmdonut.com`. Railpack builds the image from `railpack.json`: the Rust provider; Node 24.21.0 and pnpm 12.8.1 from mise for the client build; `cargo build --release --locked`; and a final image with only `bin/psstore-server` and `client/build` on the Railpack runtime image. The start command is `./bin/psstore-server`. The server binds `0.0.0.0:$PORT`. Every build and start setting is in the repository, so a revert restores the previous build. The Railway service settings (the healthcheck path `/healthz`, the custom domain, and the variables `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`) are not in the repository; record any change to them in the PR.
- **Build-time variables:** Railway gives every service variable to every build command, and `"secrets": []` in `railpack.json` limits only the cache scope. A dependency's build script can read the IGDB credentials during the build. The NPSSO is never a service variable. Compensating controls: `Cargo.lock` and `pnpm-lock.yaml` with `--locked` and `--frozen-lockfile`, `cargo deny`, `cargo audit`, `pnpm audit`, and the `allowBuilds` list in `pnpm-workspace.yaml`.
- **Railpack version:** the service does not set `RAILPACK_VERSION`, so Railway picks the builder version. The plan evidence (`railpack info --show-plan .`) comes from Railpack 0.40.1. Railpack prints the warning that its config file format is not final. After a Railpack change, compare the plan again.
- **Release checks:** after a merge, confirm with the Railway deployment list that the merge commit has status SUCCESS. Then run public GET checks on the live site: `/healthz`, `/api/games/new`, `/api/games/upcoming`, one `/api/games/<id>`, an `assets/index-*.js` bundle, and one SPA route with `Accept: text/html`. Send `POST /api/session` with a made-up NPSSO of the valid format (never a real one) and expect 401 `SessionRejected`, not 502: this proves that the deployed build reaches Sony's sign-in server. Read Railway's memory metric for the release record.
- **Observe:** the structured server log in Railway (§9) and Railway's metrics.
- **Recover:** a failed build or a failed healthcheck keeps the previous deployment live. For a defect after a successful deployment, roll back to the previous deployment in Railway (the image is kept), then revert the merge commit on a feature branch and merge the revert, so `main` matches production. The server keeps no durable data, so no data migration or restore applies. A leaked NPSSO cannot be recovered by a revert: the owner signs out of Sony to invalidate it.
- **Data:** the server keeps only the in-memory `TtlCache` (§6). The client persists only the anonymous `games` and `game` queries (§14 → Caching). The browser keeps the HttpOnly `npsso` cookie for 30 days at most.
