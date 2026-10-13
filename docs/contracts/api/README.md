# API contract examples

These files are examples of the JSON bodies of the `/api` routes. Together they show each payload shape and each failure of the API contract between the server and the client. `contract/openapi.json` defines the contract. The server exports it from the registered routes (`crates/server/src/http/openapi.rs`). The examples pin the exact JSON: the keys, the key order, the `null` values, and the absent keys.

## Examples

| File                                           | Route                                                         | Status | Content                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `page-first.json`                              | a list route, `/search`, `/browse`, `/purchased`, `/wishlist` | 200    | A page with a product card, a card with `plusUpsellText`, a concept card, and a numeric `nextOffset` |
| `page-last.json`                               | the same routes                                               | 200    | The last page: a pre-order card, a discounted card, and `nextOffset: null`                           |
| `game-detail-plus-price.json`                  | `/api/games/{id}`                                             | 200    | A PS Plus price offer and a critic score                                                             |
| `game-detail-plus-included.json`               | `/api/games/{id}`                                             | 200    | A game in a PS Plus tier and no critic score: the `criticScore` key is absent                        |
| `genres.json`                                  | `/api/games/genres`                                           | 200    | The BROWSE genre menu                                                                                |
| `error-invalid-request.json`                   | every route with a parameter or a body                        | 400    | Problem `invalid_request`                                                                            |
| `error-not-found.json`                         | an unknown `/api` path, or another method on an `/api` path   | 404    | Problem `not_found`                                                                                  |
| `error-game-not-found.json`                    | `/api/games/{id}`                                             | 404    | Problem `game_not_found`                                                                             |
| `error-session-rejected.json`                  | `/purchased`, `/wishlist`, `POST /api/session`                | 401    | Problem `session_rejected`                                                                           |
| `error-unsupported-media-type.json`            | `POST /api/session`                                           | 415    | Problem `unsupported_media_type`                                                                     |
| `error-payload-too-large.json`                 | `POST /api/session`                                           | 413    | Problem `payload_too_large`                                                                          |
| `error-upstream-unavailable.json`              | every store and account route                                 | 502    | Problem `upstream_unavailable`                                                                       |
| `error-upstream-query-rotated.json`            | every store and account route                                 | 502    | Problem `upstream_query_rotated`                                                                     |
| `error-upstream-rate-limited.json`             | every store and account route                                 | 503    | Problem `upstream_rate_limited` without `retryAfterSeconds`                                          |
| `error-upstream-rate-limited-retry-after.json` | every store and account route                                 | 503    | Problem `upstream_rate_limited` with `retryAfterSeconds`                                             |
| `error-internal-error.json`                    | every route                                                   | 500    | Problem `internal_error`                                                                             |

Every failure of an `/api` route is an RFC 9457 Problem Details body with the media type `application/problem+json`. `type` is always `about:blank`, `title` is the HTTP status phrase, `detail` is a fixed text per `code`, and `code` is the stable application code that the client reads. `detail` never contains a credential, a URL, upstream text, or request data. The success responses `204` of `POST /api/session` and `DELETE /api/session` have no body, so they have no example here.

## Data

The game cards come from the public Finnish store, as the TypeScript server returned them on 2026-10-13. The examples keep one screenshot and one video per card and a short part of each description. The critic score `87` is synthetic. The examples contain no personal data and no credential.

## Tests

Two tests read every file:

- `crates/server/tests/api_contract.rs` builds the same value with the Rust domain types and the Problem Details mapping. The test gets each body from an HTTP response, like the server does. It compares the body with the example: the values, the escapes, the key order of each object, the media type, and the status of the table above. The test also checks that the directory and the table above name the same files, that each problem code has an example, and that `contract/openapi.json` is the export of the current routes.
- `shared/src/__tests__/apiContract.test.ts` decodes each example with the shared Effect Schema and encodes the result again. The test expects the same JSON with the same key order. The decode rejects an unknown key. The test also checks that the table above names the same files as its cases.

To add an example, add the file, add a row to the table above, and add a case to both tests.

The parity tool `crates/server/examples/api_parity.rs` compares two running servers. It does not read these files.
