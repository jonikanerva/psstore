import { describe, expect, it } from 'vitest'
import type { ContractFeature, SonyContractManifest } from '../contract/types.js'
import { validateBackendCompatibility } from '../compat/backend.js'

const features: ContractFeature[] = [
  'new',
  'upcoming',
  'discounted',
  'plus',
  'search',
  'details',
]

const manifest: SonyContractManifest = {
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

describe('validateBackendCompatibility', () => {
  it('accepts compatible manifest', () => {
    const context = {
      serverEnvText:
        "SONY_GRAPHQL_URL: z.string().url().default('https://web.np.playstation.com/api/graphql/v1/op')\nSONY_OPERATION_NAME: z.string().default('categoryGridRetrieve')",
      sonyClientText:
        "headers: { 'x-apollo-operation-name': strategy.operationName }\nreturn json.data?.categoryGridRetrieve?.concepts ?? []",
      mapperText: 'export const conceptToGame = (concept) => concept',
      serviceText: 'await fetchConceptsByFeature(\'new\', 300)\nawait fetchSearchConcepts(\'elden\', 120)',
    }

    expect(() => validateBackendCompatibility(manifest, context)).not.toThrow()
  })
})
