import { describe, expect, it } from 'vitest'
import { createManifest } from '../contract/manifest.js'
import type { ContractOperation } from '../contract/types.js'

const operations: ContractOperation[] = [
  {
    feature: 'new',
    operation_name: 'categoryGridRetrieve',
    persisted_query_hash: 'a'.repeat(64),
    required_headers: ['x-apollo-operation-name'],
    variables_schema: { id: 'string', targetPlatforms: ['PS5'], currencyCode: 'EUR' },
    sample_variables: { id: 'x', targetPlatforms: ['PS5'], currencyCode: 'EUR' },
    response_path: 'data.categoryGridRetrieve.products',
    observed_status_codes: [200],
  },
]

describe('createManifest', () => {
  it('hardcodes finnish PS5 EUR metadata', () => {
    const manifest = createManifest(
      {
        capturedBy: 'tester',
        endpointUrl: 'https://web.np.playstation.com/api/graphql/v1/op',
      },
      operations,
    )

    expect(manifest.metadata.region).toBe('fi')
    expect(manifest.metadata.locale).toBe('fi-fi')
    expect(manifest.metadata.currency).toBe('EUR')
    expect(manifest.metadata.target_platform).toBe('PS5')
  })
})
