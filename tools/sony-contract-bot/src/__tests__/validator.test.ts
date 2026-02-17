import { describe, expect, it } from 'vitest'
import type { ContractFeature, SonyContractManifest } from '../contract/types.js'
import { validateManifest } from '../contract/validator.js'

const features: ContractFeature[] = [
  'new',
  'upcoming',
  'discounted',
  'plus',
  'search',
  'details',
]

const validManifest: SonyContractManifest = {
  version: 1,
  metadata: {
    captured_at: '2026-02-17T00:00:00.000Z',
    captured_by: 'codex',
    region: 'fi',
    locale: 'fi-fi',
    currency: 'EUR',
    target_platform: 'PS5',
    playwright_profile: 'default',
  },
  endpoint: {
    url: 'https://web.np.playstation.com/api/graphql/v1/op',
    method: 'GET',
  },
  operations: features.map((feature) => ({
    feature,
    operation_name: 'categoryGridRetrieve',
    persisted_query_hash: 'a'.repeat(64),
    required_headers: ['x-apollo-operation-name'],
    variables_schema: { id: 'string' },
    sample_variables: { id: 'x' },
    response_path: 'data.categoryGridRetrieve.products',
    observed_status_codes: [200],
  })),
}

describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    expect(() => validateManifest(validManifest)).not.toThrow()
  })

  it('rejects missing feature coverage', () => {
    const invalid: SonyContractManifest = {
      ...validManifest,
      operations: validManifest.operations.filter((op) => op.feature !== 'details'),
    }

    expect(() => validateManifest(invalid)).toThrow(/Missing required feature mapping/)
  })
})
