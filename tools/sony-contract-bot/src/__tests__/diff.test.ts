import { describe, expect, it } from 'vitest'
import type { SonyContractManifest } from '../contract/types.js'
import { diffManifests } from '../contract/diff.js'

const base: SonyContractManifest = {
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
  operations: [
    {
      feature: 'new',
      operation_name: 'categoryGridRetrieve',
      persisted_query_hash: 'a'.repeat(64),
      required_headers: ['x-apollo-operation-name'],
      variables_schema: { id: 'string' },
      sample_variables: { id: 'x' },
      response_path: 'data.categoryGridRetrieve.products',
      observed_status_codes: [200],
    },
  ],
}

describe('diffManifests', () => {
  it('detects changed hash drift', () => {
    const next: SonyContractManifest = {
      ...base,
      operations: [
        {
          ...base.operations[0],
          persisted_query_hash: 'b'.repeat(64),
        },
      ],
    }

    const diff = diffManifests(base, next)
    expect(diff.hasDrift).toBe(true)
    expect(diff.changed).toHaveLength(1)
  })
})
