# ADR 0004: The repository follows the default Rust profile

- Status: accepted
- Date: 2026-10-14
- Issue: #157

## Context

ADR 0003 ported the server to Rust. The port kept the TypeScript project structure: one server crate, a `shared/` package with the Effect Schema view of the API, pnpm scripts as the command surface, and handwritten API examples as the contract between the two languages.

The owner keeps a default profile for Rust services in the agent-setup repository (`stacks/STACK-RUST.md`, selection of 13 October 2026). The owner asked for a comparison of this repository with that profile. The comparison found these differences:

- The profile has a pure domain crate and a server crate in a Cargo workspace, with workspace lints. This repository had one crate and a test that guarded the domain module.
- The profile generates an OpenAPI 3.1 document from the Rust routes and a TypeScript client with Zod validators from the document. Every error is an RFC 9457 Problem Details body. This repository had handwritten TypeScript types in `shared/` and its own error bodies.
- The profile uses mise tasks as the command surface, nextest as the test runner, cargo-shear, and the advisories check of cargo-deny. This repository used pnpm scripts and cargo-audit.
- The profile has request correlation, a readiness route, a version route, security headers, a tested shutdown deadline, and browser journeys with an accessibility check. This repository had none of them.

## Owner decision

Finnish source text from the chat, with the lead's English translation:

- 2026-10-13: "tee kaikki muutokset tähän PR:ään. haluan, että tämä repo on lähellä default rust stakkiä. mikäli defaultissa oli jotain tästä opittavaa, tee muutoks myös ~/Sites/agent-setup/stacks/STACK-RUST.md tiedostoon mutta älä kommittoi sitä." ("make all the changes in this PR. I want this repo to be close to the default Rust stack. If the default had something to learn from this, change ~/Sites/agent-setup/stacks/STACK-RUST.md too, but do not commit it.")

## Decision

1. `STACK.md` follows the section structure and the rules of the profile. The project facts (the scope boundary, the Sony sign-in, the outbound sources, the live checks, and the Railway release) fill the profile sections. `STACK.md` §13 lists every remaining divergence with its reason.
2. The Cargo workspace has two crates. `crates/domain` holds the pure types and rules; its `clippy.toml` bans ambient time, environment, filesystem, network, process, and random access. `crates/server` holds the effects, the HTTP interface, and the adapters. Both inherit the workspace lints of the profile. Entity ids have newtypes, and the expected errors use thiserror.
3. The Rust routes are the source of the API contract. utoipa exports `contract/openapi.json`. Hey API generates the TypeScript SDK, the types, and the Zod validators in `packages/api-client`. A handwritten facade validates every success body and every error body. The web app calls the API only through the facade. `shared/` is removed, and Effect is removed from the repository.
4. Every `/api` error is a Problem Details body with a stable `code`. The success bodies, the statuses, and the headers of the TypeScript server stay the same.
5. Mise tasks are the command surface. `mise run verify` is `$VERIFY_CMD`. The root `package.json` keeps thin aliases (`pnpm dev`, `pnpm test-all`, and others), because `CLAUDE.md` names `pnpm dev` in the owner hand-off.
6. The verification uses nextest, cargo-shear, and the full `cargo deny check` including advisories. cargo-audit is removed.
7. The server has a random request id in each request span, `/readyz`, `/version`, the security headers of the profile, and a tested 35-second shutdown deadline. The client package is renamed from `client/` to `web/`.
8. Playwright and axe test the critical journeys against a deterministic test server with synthetic data.
9. The lessons of this repository go into the agent-setup profile as uncommitted changes: the TypeScript 7 alternative, outbound sources, cache and in-flight drop guards, live checks of external sources, the replacement of an existing service, and Railpack limits.

## Alternatives

- **Keep the structure of ADR 0003.** Rejected by the owner's decision.
- **Adopt the profile without divergences.** Not possible. Sony offers no OIDC for third parties, the owner approved TypeScript 7 with Oxlint, the owner set no performance budget, and Railpack 0.40.1 cannot decode inherited package fields in the binary crate. `STACK.md` §13 records these.
- **A separate pull request for the alignment.** Rejected by the owner's decision: the changes are in the port pull request.
- **An `X-Request-Id` response header.** Not chosen. The request id is useful in the server log only, and the profile does not require the header.

## Consequences

- A fresh machine needs `mise trust` and `mise run setup` before the first run. The hand-off command `pnpm dev` still works after that.
- A browser tab that loaded the TypeScript client before the release receives Problem Details errors. The statuses do not change, so the sign-in form still appears on a 401. A reload loads the new client.
- The generated client brings three scoped exceptions in `STACK.md` §13: `exactOptionalPropertyTypes` is off for the generated directory, TypeScript 6.0.3 is the generator's peer, and a pnpm override pins a fixed js-yaml in the generator's dependency.
- A change to an `/api` route or response type needs `mise run contract:export` and `mise run contract:generate`. `contract:check` in `verify` fails on drift.
- On 2026-10-14 the agent-setup repository received two commits under the owner's name, outside this pull request's session: `d2174a5` adds the lessons, and `5ad114f` revises the profile: TypeScript 7 with Oxlint is the only frontend path, deterministic browser journeys are part of the profile, and the port-only sections are removed. `STACK.md` follows `5ad114f`.

## Cost of reversal

Medium. Each decision is a separate commit in the pull request of issue #157. A revert of the merge commit restores the TypeScript server and its structure.

## Reassessment

Reassess when the profile changes, when utoipa or Hey API loses maintenance, or when a generator upgrade removes the need for a §13 exception.
