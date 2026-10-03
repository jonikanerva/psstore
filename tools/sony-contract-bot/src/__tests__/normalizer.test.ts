import { describe, expect, it } from 'vitest'
import type { ContractOperation } from '../contract/types.js'
import { diffManifests } from '../contract/diff.js'
import {
  normalizeOperations,
  withSignedInOperations,
} from '../contract/normalizer.js'
import type { SonyContractManifest } from '../contract/types.js'

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

describe('withSignedInOperations', () => {
  const purchased: ContractOperation = {
    feature: 'purchased',
    operation_name: 'getPurchasedGameList',
    persisted_query_hash: 'c'.repeat(64),
    required_headers: ['x-apollo-operation-name'],
    variables_schema: { size: 'number' },
    sample_variables: { size: 100 },
    response_path: 'data.purchasedTitlesRetrieve.games',
    observed_status_codes: [200],
  }
  const search: ContractOperation = {
    ...purchased,
    feature: 'search',
    operation_name: 'getSearchResults',
    observed_status_codes: [200],
  }
  const manifestOf = (ops: ContractOperation[]): SonyContractManifest => ({
    version: 1,
    metadata: {
      captured_at: '2026-10-03T00:00:00.000Z',
      captured_by: 'test',
      region: 'fi',
      locale: 'fi-fi',
      currency: 'EUR',
      target_platform: 'PS5',
      playwright_profile: 'default',
    },
    endpoint: { url: 'https://example.invalid/op', method: 'GET' },
    operations: ops,
  })

  it('carries the canonical purchased entry over verbatim', () => {
    const refreshed = normalizeOperations(
      withSignedInOperations([search], [purchased]),
    )
    expect(refreshed.find((op) => op.feature === 'purchased')).toEqual(
      purchased,
    )
  })

  it('reports no drift between canonical and a refreshed candidate', () => {
    const captured = [search]
    const canonical = normalizeOperations([search, purchased])
    const candidate = normalizeOperations(
      withSignedInOperations(captured, canonical),
    )
    expect(
      diffManifests(manifestOf(canonical), manifestOf(candidate)).hasDrift,
    ).toBe(false)
  })

  it('keeps an unobserved entry unobserved', () => {
    const unobserved = { ...purchased, observed_status_codes: [] }
    const result = withSignedInOperations([search], [unobserved])
    expect(result.at(-1)?.observed_status_codes).toEqual([])
  })

  it('adds nothing when the canonical manifest has no signed-in entry', () => {
    expect(withSignedInOperations([search], [search])).toEqual([search])
  })
})
