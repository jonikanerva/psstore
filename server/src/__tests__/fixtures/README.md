# Golden decode fixtures (real Sony captures)

These `*.golden.json` files are **lightly-trimmed real responses** captured from
live Sony (`web.np.playstation.com`, locale `fi-fi`) via the production
persisted-query GET path (the same request `server/src/sony/sonyClient.ts`
issues; hashes from `server/src/config/env.ts`).

They guard the Sony boundary against live `null` values: hand-authored fixtures
have no `null`-valued items, so they decode fine while live data breaks. **Every `null` the live response
contained is preserved verbatim** — these are the real shapes, not a synthetic
minimal. `goldenDecode.test.ts` asserts the boundary decodes + maps them.

- **Captured:** 2026-05-31, fi-fi, PS5, EUR.
- **Trimming (not redaction):** a GraphQL _response_ body carries no
  tokens/cookies, so this is size-trimming only — incidental fields not read by
  the boundary schema/mapper (`personalizedMeta`, `telemetryData`, `__typename`)
  were dropped and `media[]` was capped to cover/screenshot roles. Volatile
  prices/dates are kept as captured (the tests assert STRUCTURE, not values).

| File                                    | Envelope                                | Real-data shapes preserved                                                                                                                     |
| --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `categoryGridConcepts.golden.json`      | `concepts` (NEW/UPCOMING category)      | NEW released SKUs incl. one with a `PS_PLUS` upsell + `upsellText`; 3 UPCOMING bare concepts with `price: null` (the `idKind: 'concept'` path) |
| `categoryGridProducts.golden.json`      | `products` (DISCOUNTED/deals category)  | exercises the `products → productToConcept` branch; incl. a product with `price.serviceBranding: null` and PS_PLUS-discounted SKUs             |
| `categoryGridBrokenElement.golden.json` | `concepts` + 1 synthetic                | the concepts fixture plus ONE synthetic deliberately-broken element (id of the wrong type) so the per-element `dropped > 0` path is asserted   |
| `productDetail.golden.json`             | `productRetrieve` (`metGetProductById`) | real LONG/SHORT/LEGAL/COMPATIBILITY_NOTICE descriptions + genres + a real `null` field (`backwardsCompatibilityCategory`)                      |

To re-capture, repeat the live fetch with the current `config/env.ts` hashes and
re-trim, preserving nulls.
