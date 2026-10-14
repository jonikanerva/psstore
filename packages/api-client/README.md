# @psstore/api-client

The TypeScript client of the `/api` routes. The web app calls the API only through this package.

- `src/generated/` is the output of Hey API (`@hey-api/openapi-ts`) for `contract/openapi.json`: the fetch client, the SDK functions, the wire types, and the Zod validators. Never edit it by hand.
- `src/index.ts` is the handwritten facade: one function per operation, the runtime validation of success and error bodies, and the typed `ApiError`.

## Commands

| Command                                                        | What it does                                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @psstore/api-client run generate`               | Generates `src/generated/` from the committed `contract/openapi.json`.                                                                                |
| `pnpm --filter @psstore/api-client run typecheck`              | Type-checks the facade and the tests with TypeScript 7, and the generated code as a referenced project.                                               |
| `pnpm --filter @psstore/api-client run test`                   | Runs the facade tests and the API example tests (Vitest).                                                                                             |
| `pnpm --filter @psstore/api-client run contract-check`         | Exports the OpenAPI document from the Rust routes and generates the client in a scratch directory, then compares both trees with the committed trees. |
| `cargo run --locked -p psstore-server --bin openapi -- <path>` | Writes the OpenAPI document of the Rust routes to `<path>`.                                                                                           |

After a change to an `/api` route, run the export to `contract/openapi.json`, run `generate`, and commit both. `contract-check` fails until both are current.

## Runtime behaviour

- A success body goes through the generated Zod schema of its route before a function returns it. A body that breaks the contract, or a success answer that is not JSON, is an `ApiError` with the code `invalid_response`.
- An error body goes through the generated `Problem` schema. A known `code` with its documented status is an `ApiError` with that code. An unknown code, an invalid body, or the non-JSON answer of an intermediary is an `ApiError` with the code `unrecognized_error` and the HTTP status.
- A failure without an HTTP response, for example a network error or an abort, keeps its original error.
- An unknown key in a success body does not fail validation. The client reads only the contract keys.

## Toolchain notes

- The generator imports the TypeScript compiler API (`ts.factory`). The `typescript` 7 package has no compiler API, so this package pins `typescript` 6.0.3 as the generator's peer. The type check uses the TypeScript 7 compiler of the workspace root.
- The client runtime that the generator copies into `src/generated/client` and `src/generated/core` does not compile under `exactOptionalPropertyTypes`. `tsconfig.generated.json` checks `src/generated/` as a referenced project with every other strict flag and without that one flag. The facade, the tests, and the web app keep the full flag set.
