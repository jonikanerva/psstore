import type { ContractFeature } from '../contract/types.js'

export interface FeatureRoute {
  feature: ContractFeature
  url: string
}

// Evergreen PDP product id for the `details` feature route.
//
// The `details` feature MEANS the product-detail-page operation
// `metGetProductById` (`data.productRetrieve`) — the operation that feeds the
// PDP *and* the NEW/DISCOUNTED release-date + classification enrichment
// (server `gamesService.ts`). It is NOT a category-grid facet. To observe the
// `metGetProductById` request Sony fires, capture must navigate to a real
// product page, which needs a fixed product id baked into the route list.
//
// Why hard-coded (not derived): capture is a deterministic route list — no
// dynamic id derivation (STACK.md §10 forbids scheduled / dynamic capture).
//
// Why THIS id: a first-party Sony Interactive Entertainment PS5 launch title
// (Demon's Souls, released 2020-11-11, FULL_GAME, priced in EUR on the fi-fi
// store). First-party + flagship launch exclusive ⇒ least likely to be
// delisted. Verified live (2026-06-01) to return HTTP 200 + `data.productRetrieve`
// against `SONY_PRODUCT_BY_ID_HASH` (`server/src/config/env.ts`).
//
// ROTATION RUNBOOK: if `pnpm sony:refresh` fails with
// "Scope filtering removed required feature coverage: details", the pinned PDP
// product was likely delisted — pick a new priced first-party PS5 product id
// from a fresh `new` grid capture (a concept's `products[0].id`) and replace the
// value below.
const PDP_PRODUCT_ID = 'EP9000-PPSA01341_00-DEMONSSOULS00000'

export const coreFeatureRoutes: FeatureRoute[] = [
  {
    feature: 'new',
    url: 'https://store.playstation.com/fi-fi/category/d0446d4b-dc9a-4f1e-86ec-651f099c9b29/1?PS5=targetPlatforms',
  },
  {
    feature: 'upcoming',
    url: 'https://store.playstation.com/fi-fi/category/d0446d4b-dc9a-4f1e-86ec-651f099c9b29/1?PS5=targetPlatforms&facet=upcoming',
  },
  {
    feature: 'discounted',
    url: 'https://store.playstation.com/fi-fi/category/d0446d4b-dc9a-4f1e-86ec-651f099c9b29/1?PS5=targetPlatforms&facet=discounted',
  },
  {
    feature: 'details',
    url: `https://store.playstation.com/fi-fi/product/${PDP_PRODUCT_ID}`,
  },
]
