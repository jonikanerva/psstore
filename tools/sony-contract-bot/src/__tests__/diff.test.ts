import { describe, expect, it } from 'vitest'
import type {
  ContractOperation,
  SonyContractManifest,
} from '../contract/types.js'
import { diffManifests } from '../contract/diff.js'

const gridOperation: ContractOperation = {
  feature: 'new',
  operation_name: 'categoryGridRetrieve',
  persisted_query_hash: 'a'.repeat(64),
  required_headers: ['x-apollo-operation-name'],
  variables_schema: { id: 'string' },
  sample_variables: { id: 'x' },
  response_path: 'data.categoryGridRetrieve.products',
  observed_status_codes: [200],
}

const pdpOperation: ContractOperation = {
  feature: 'details',
  operation_name: 'metGetProductById',
  persisted_query_hash: 'b'.repeat(64),
  required_headers: ['x-apollo-operation-name'],
  variables_schema: { productId: 'string' },
  sample_variables: { productId: 'EP9000-PPSA01341_00-DEMONSSOULS00000' },
  response_path: 'data.productRetrieve',
  observed_status_codes: [200],
}

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
  operations: [gridOperation, pdpOperation],
}

const withPdp = (next: ContractOperation): SonyContractManifest => ({
  ...base,
  operations: [gridOperation, next],
})

describe('diffManifests', () => {
  it('detects changed grid hash drift', () => {
    const next: SonyContractManifest = {
      ...base,
      operations: [
        { ...gridOperation, persisted_query_hash: 'c'.repeat(64) },
        pdpOperation,
      ],
    }

    const diff = diffManifests(base, next)
    expect(diff.hasDrift).toBe(true)
    expect(diff.changed).toHaveLength(1)
  })

  it('detects a rotated PDP persisted_query_hash', () => {
    const diff = diffManifests(
      base,
      withPdp({ ...pdpOperation, persisted_query_hash: 'd'.repeat(64) }),
    )
    expect(diff.hasDrift).toBe(true)
    expect(diff.changed).toHaveLength(1)
  })

  it('detects a changed PDP response_path', () => {
    const diff = diffManifests(
      base,
      withPdp({ ...pdpOperation, response_path: 'data.somethingElse' }),
    )
    expect(diff.hasDrift).toBe(true)
    expect(diff.changed).toHaveLength(1)
  })

  it('detects a changed PDP variables_schema', () => {
    const diff = diffManifests(
      base,
      withPdp({ ...pdpOperation, variables_schema: { conceptId: 'string' } }),
    )
    expect(diff.hasDrift).toBe(true)
    expect(diff.changed).toHaveLength(1)
  })
})
