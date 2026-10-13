# ADR 0003: The server is a Rust program

- Status: accepted
- Date: 2026-10-13
- Issue: #157

## Context

The server was a TypeScript program on Effect v4: an `effect/http-api` REST API, an Effect `Cache`, and Effect Schema decoders shared with the client. It runs as one Railway service.

- Railway's memory metric of the service over the 7 days before 2026-10-10 was 94 MB at the lowest, 206 MB on average, and 361 MB at the highest. The owner's Rust service `commute` used less than 10 MB in the same Railway metric. The two services do different work, so the numbers are not a like-for-like comparison. The psstore server keeps up to 10 000 product details in memory, and a Rust server keeps the same data.
- The server used `effect/http` and `effect/http-api`. Effect marks both modules `@stability unstable`, so STACK.md §15 had a permanent divergence for them.
- STACK.md §3 recorded that Context7 has no Effect 4.0.0 corpus and that agents drift to the Effect v3 API.
- The owner's other service, `commute`, is a Rust program with Axum, Tokio, Reqwest, Serde, Jiff, and tracing. Its verification (rustfmt, Clippy, cargo-deny, cargo-audit, Gitleaks) and its Railway build work.

## Owner decisions

Finnish source text from the chat, with the lead's English translation:

- 2026-10-13: "ei mitata mitään, edetään rust portin kanssa. haluan tästä yhden PR:n jossa on koko rust porttaus, jotta rust versiota voidaan testata lokaalisti ennenkuin mitään julkaistaan tuotanoon" ("we measure nothing, we go ahead with the Rust port. I want one PR with the whole Rust port, so that the Rust version can be tested locally before anything is released to production").
- 2026-10-13, on how to verify the Linux build: "c käy, aloita toteutus. minä haluan reviewata PR:n kun se on saanut tiimiltä PASS ja minä mergeän" ("c is fine, start the implementation. I want to review the PR after it has a PASS from the team, and I merge"). Option c was: verify the Linux build at the merge. The Railway healthcheck keeps the previous version live when the build or the start fails, and Railway rollback is the fast recovery path.

## Decision

1. The server is one Rust crate in `server/`: Axum on a current-thread Tokio runtime, Reqwest with Rustls, Serde, Jiff, and tracing. STACK.md §2 and §7 list the crates and their reasons.
2. The `/api` contract does not change. The routes, the statuses, the JSON bodies, and the relevant headers stay the same as on the TypeScript server. The client does not change.
3. The client stays React, Vite, and TypeScript. `shared/` stays as the TypeScript view of the API contract. The committed examples in `docs/contracts/api/` are the contract between the two languages: a Rust test serializes the same values and a TypeScript test decodes the same files.
4. The Sony contract values (the endpoint, the operation names, the persisted-query hashes, and the category ids) are in `docs/contracts/sony-constants.json`. The server compiles the file in, and the contract tooling reads the same file.
5. `pnpm` stays the command surface. The scripts in the root `package.json` call `cargo`. `pnpm test-all` stays `$VERIFY_CMD`.
6. Railway builds the service with Railpack from `railpack.json`: the Rust provider, Node and pnpm from mise for the client build, and a final image that contains only the server binary and `client/build`.

## Alternatives

- **Keep the TypeScript server and reduce its memory** (smaller cache capacities, a smaller V8 heap). Not measured: the owner decided against a measurement. It keeps the unstable Effect HTTP modules.
- **Rust for the client too** (a WebAssembly framework). Rejected. The client runs in the browser, so it does not change the server memory, and it would replace a tested React client.
- **Generate the TypeScript types from an OpenAPI document of the Rust server.** Not chosen. It adds two dependencies for a small API. The committed examples catch a shape change on both sides.
- **A Makefile as the command surface, as in `commute`.** Not chosen. The client and the contract tooling need pnpm anyway, and the owner's hand-off command `pnpm dev` stays valid.
- **A cache crate (`moka`).** Not chosen. It reads its own clock, so tests cannot pause it. The hand-written cache follows the Effect `Cache` semantics that the server used and is tested with a paused Tokio clock.
- **A Dockerfile for the Railway build.** Not chosen. `railpack.json` can install both toolchains, and a Dockerfile replaces the supported builder with custom build code.

## Consequences

- The repository has two toolchains: Rust for the server and Node for the client and the contract tooling. Node is a build-time tool only; the production image contains no Node.
- `pnpm test-all` also runs rustfmt, Clippy, cargo-deny, cargo-audit, the Rust release build, and `cargo test`.
- The memory use of the Rust server is not measured before the release, and no budget is set. Railway's memory metric shows it after the release.
- Railway gives the service variables (the IGDB credentials) to every build command, as it did for the Node build. A Rust build script of a dependency can read them. The NPSSO is never a service variable.
- The Railway service does not pin the Railpack version. The local plan evidence comes from Railpack 0.40.1. Railpack prints the warning that its config file format is not final.
- Known differences from the TypeScript server are listed in the pull request of issue #157.

## Cost of reversal

Medium. A revert of the merge commit restores the TypeScript server and its Railway build, because every build setting is in the repository. The cost grows with each later change to the Rust server.

## Reassessment

Reassess when the Rust server fails to build or to start on Railway, when a dependency in STACK.md §7 loses maintenance, or when the two toolchains cost more than the server work they support.
