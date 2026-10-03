import type { ContractFeature } from '../contract/types.js'

export interface FeatureRoute {
  feature: ContractFeature
  url: string
}

// Evergreen PDP product id for the `details` feature route. It captures the
// price operation the product page fires. The page does not fire
// `metGetProductById`; refresh verifies that operation with a live probe
// (`contract/pinnedOperations.ts`).
//
// The id is fixed because capture is a deterministic route list. It is a
// first-party PS5 launch title (Demon's Souls), the least likely to be delisted.
// If `pnpm sony:refresh` fails with "Scope filtering removed required feature
// coverage: details", the product was probably delisted. Pick a priced
// first-party PS5 product id from a fresh `new` grid capture and replace the
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
