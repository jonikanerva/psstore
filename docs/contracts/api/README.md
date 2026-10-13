# API contract examples

These files are examples of the JSON bodies of the `/api` routes. Together they show each payload shape of the API contract between the server and the client. The shared Effect Schemas in `shared/src/schemas/` define the contract. The examples pin the exact JSON: the keys, the key order, the `null` values, and the absent keys.

## Examples

| File                                           | Route                                                         | Status | Content                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `page-first.json`                              | a list route, `/search`, `/browse`, `/purchased`, `/wishlist` | 200    | A page with a product card, a card with `plusUpsellText`, a concept card, and a numeric `nextOffset` |
| `page-last.json`                               | the same routes                                               | 200    | The last page: a pre-order card, a discounted card, and `nextOffset: null`                           |
| `game-detail-plus-price.json`                  | `/api/games/{id}`                                             | 200    | A PS Plus price offer and a critic score                                                             |
| `game-detail-plus-included.json`               | `/api/games/{id}`                                             | 200    | A game in a PS Plus tier and no critic score: the `criticScore` key is absent                        |
| `genres.json`                                  | `/api/games/genres`                                           | 200    | The BROWSE genre menu                                                                                |
| `error-game-not-found.json`                    | `/api/games/{id}`                                             | 404    | `GameNotFound`                                                                                       |
| `error-upstream-unavailable.json`              | every store route                                             | 502    | `UpstreamUnavailable`                                                                                |
| `error-upstream-query-rotated.json`            | every store route                                             | 502    | `UpstreamQueryRotated`                                                                               |
| `error-upstream-rate-limited.json`             | every store route                                             | 503    | `UpstreamRateLimited` without `retryAfterSeconds`                                                    |
| `error-upstream-rate-limited-retry-after.json` | every store route                                             | 503    | `UpstreamRateLimited` with `retryAfterSeconds`                                                       |
| `error-session-rejected.json`                  | `/purchased`, `/wishlist`, `POST /api/session`                | 401    | `SessionRejected`                                                                                    |

A route answers an invalid request with an empty 400. A known path with another method answers an empty 404. These responses have no body, so they have no example here. `POST /api/session` with a content type other than JSON answers 415 with a `text/plain` body, for example `Unsupported content-type: text/plain`. That body is not JSON, so it has no example here either.

## Data

The game cards come from the public Finnish store, as the TypeScript server returned them on 2026-10-13. The examples keep one screenshot and one video per card and a short part of each description. The critic score `87` is synthetic. The error messages are the messages of the TypeScript server. The client reads only the status and the `_tag` of an error, so a message can change. The examples contain no personal data and no credential.

## Tests

Two tests read every file:

- `crates/server/tests/api_contract.rs` builds the same value with the Rust domain types. The test gets each body from an HTTP response, like the server does. It compares the body with the example: the values, the escapes, the key order of each object, and the status. The test also checks that the directory and the table above name the same files.
- `shared/src/__tests__/apiContract.test.ts` decodes each example with the shared Effect Schema and encodes the result again. The test expects the same JSON with the same key order. The decode rejects an unknown key. The test also checks that the table above names the same files as its cases.

To add an example, add the file, add a row to the table above, and add a case to both tests.

The parity tool `crates/server/examples/api_parity.rs` compares two running servers. It does not read these files.
