import type { ContractFeature } from '../contract/types.js'

export interface FeatureRoute {
  feature: ContractFeature
  url: string
}

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
    feature: 'plus',
    url: 'https://store.playstation.com/fi-fi/category/d0446d4b-dc9a-4f1e-86ec-651f099c9b29/1?PS5=targetPlatforms&facet=plus',
  },
  {
    feature: 'search',
    url: 'https://store.playstation.com/fi-fi/category/d0446d4b-dc9a-4f1e-86ec-651f099c9b29/1?PS5=targetPlatforms&facet=search',
  },
  {
    feature: 'details',
    url: 'https://store.playstation.com/fi-fi/category/d0446d4b-dc9a-4f1e-86ec-651f099c9b29/1?PS5=targetPlatforms&facet=details',
  },
]
