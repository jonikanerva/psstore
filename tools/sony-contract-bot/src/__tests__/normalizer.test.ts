import { describe, expect, it } from 'vitest'
import type { ContractOperation } from '../contract/types.js'
import { normalizeOperations } from '../contract/normalizer.js'

const operations: ContractOperation[] = [
  {
    feature: 'new',
    operation_name: 'categoryGridRetrieve',
    persisted_query_hash: 'b'.repeat(64),
    required_headers: ['x-apollo-operation-name'],
    variables_schema: { id: 'string' },
    sample_variables: { id: 'x' },
    response_path: 'data.categoryGridRetrieve.products',
    observed_status_codes: [200],
  },
  {
    feature: 'new',
    operation_name: 'categoryGridRetrieve',
    persisted_query_hash: 'b'.repeat(64),
    required_headers: ['x-apollo-operation-name'],
    variables_schema: { id: 'string' },
    sample_variables: { id: 'x' },
    response_path: 'data.categoryGridRetrieve.products',
    observed_status_codes: [200],
  },
]

describe('normalizeOperations', () => {
  it('deduplicates and sorts operations deterministically', () => {
    const normalized = normalizeOperations(operations)
    expect(normalized).toHaveLength(1)
    expect(normalized[0]?.feature).toBe('new')
  })
})
