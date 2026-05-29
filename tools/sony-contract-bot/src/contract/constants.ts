import type { ContractFeature } from './types.js'

export const CORE_FEATURES: ContractFeature[] = [
  'new',
  'upcoming',
  'discounted',
  'search',
  'details',
]

export const HEADER_ALLOWLIST = ['x-apollo-operation-name'] as const
