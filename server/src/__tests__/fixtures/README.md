# Golden decode fixtures (real Sony captures)

These `*.golden.json` files are **lightly-trimmed real responses** captured from
live Sony (`web.np.playstation.com`, locale `fi-fi`; the server now requests `en-fi`, which returns the same shapes) via the production
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

## Search fixture

`searchResults.golden.json` is a trimmed response of the search operation
(`getSearchResults`), captured on 2026-10-03 with locale `en-FI` from the terms
`elden`, `bloodborne`, and `florist`. Trimming kept up to two image entries per
`media` list and dropped `personalizedMeta` and `telemetryData`. It holds public
store data only. Three elements are synthetic: a concept that names one product
id, a product with a wrong-typed `id`, and an element with an unknown typename.

| File                        | Envelope                           | Shapes preserved                                                                                                                                                 |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchResults.golden.json` | `data.universalSearch`, 9 elements | PS4 and PS5 products, a PS4-only full game, a premium edition, a repeated id, a concept with `products: []`, and `pageInfo.isLast`; the synthetic elements above |

## Price operation fixtures

The `productPrice*.golden.json` files are lightly-trimmed real anonymous
responses of the price operation (`productRetrieveForCtasWithPrice`), captured
on 2026-10-02 with locale `en-FI`. Trimming kept only `id`, `name`, and for each CTA its `type`,
`meta.upSellService`, and `price`. Inside `price` it dropped `telemetryData`,
`qualifications`, `campaignId`, and `rewardId`. Every remaining price field is
kept as captured, including non-breaking spaces. No synthetic fixture
files exist for this operation. The synthetic malformed cases are inline in
`productPrice.test.ts` and are marked synthetic there.

| File                                        | Product                        | Shape preserved                                                                       |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `productPriceDiscountPreorder.golden.json`  | ANOMALITH                      | `UPSELL_PS_PLUS_DISCOUNT` (`€44,95`) plus a `PREORDER` CTA                            |
| `productPriceDiscountReleased.golden.json`  | RetroSpace (DISCOUNTED view)   | `UPSELL_PS_PLUS_DISCOUNT` (`€17,95`) plus an `ADD_TO_CART` CTA                        |
| `productPriceIncluded.golden.json`          | Sniper Elite: Resistance       | `UPSELL_PS_PLUS_FREE`, `isTiedToSubscription` true, `Included`, plus `ADD_TO_CART`    |
| `productPricePlusOnly.golden.json`          | MLB The Show 26 (Plus edition) | `UPSELL_PS_PLUS_FREE` only, no standard CTA                                           |
| `productPriceTrial.golden.json`             | IRON GUARD: Day Zero           | `UPSELL_PS_PLUS_TRIAL`, tied to the subscription, price text `Game Trial`             |
| `productPriceOtherSubscription.golden.json` | EA SPORTS FC 25                | `UPSELL_EA_ACCESS_FREE`, `EA_ACCESS` branding, `Included` (must never map to PS Plus) |

## PS Plus monthly list fixture

`plusMonthly.golden.json` is the unmodified response body of the anonymous feed
`https://www.playstation.com/bin/imagic/gameslist?locale=en-fi&categoryList=plus-monthly-games-list`,
captured on 2026-10-02. The feed sits outside the GraphQL contract tooling.
This fixture and `pnpm test:live` are its only drift guards. Response headers
(including the country cookie) are not stored.

| File                      | Envelope                      | Real-data shapes preserved                                                                                                               |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `plusMonthly.golden.json` | 27 alphabetical buckets, list | 6 entries: 4 PS5 games kept; a PS4-only entry (`CUSA` id) and an entry with `device: []` dropped; two entries that share one `conceptId` |

To re-capture, repeat the live fetch with the current `config/env.ts` hashes and
re-trim, preserving nulls.

## Signed-in library fixture

`purchasedPage.synthetic.json` is **hand-made**. It is not a Sony capture. It
holds only synthetic names, ids and URLs. No real account data, no real
purchase and no token appears in it. The shape follows the `psn-api` 2.18.1
type `PurchasedGamesResponse`. The owner-run live check with a real NPSSO
confirms that shape (`STACK.md` section 4).

| File                           | Shape                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `purchasedPage.synthetic.json` | 5 games: PS5 with a concept id, PS5 with a null concept id, PS4, platform `ps5` in odd case, and an entry with no platform |
