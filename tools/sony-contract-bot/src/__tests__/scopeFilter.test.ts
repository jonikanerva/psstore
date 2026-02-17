import { describe, expect, it } from 'vitest'
import type { ContractOperation } from '../contract/types.js'
import { filterOperationsByFinnishPs5EurScope } from '../contract/scopeFilter.js'

const makeOperation = (
  variables: Record<string, unknown>,
  sample: Record<string, unknown>,
): ContractOperation => ({
  feature: 'new',
  operation_name: 'categoryGridRetrieve',
  persisted_query_hash: 'a'.repeat(64),
  required_headers: ['x-apollo-operation-name'],
  variables_schema: variables,
  sample_variables: sample,
  response_path: 'data.categoryGridRetrieve.products',
  observed_status_codes: [200],
})

describe('filterOperationsByFinnishPs5EurScope', () => {
  it('keeps PS5 EUR operations', () => {
    const operations = [
      makeOperation(
        { targetPlatforms: ['PS5'], locale: 'fi-fi', currencyCode: 'EUR' },
        { targetPlatforms: ['PS5'], locale: 'fi-fi', currencyCode: 'EUR' },
      ),
    ]

    expect(filterOperationsByFinnishPs5EurScope(operations)).toHaveLength(1)
  })

  it('keeps PS5 operations when currency/locale are not explicit', () => {
    const operations = [
      makeOperation(
        { filterBy: ['targetPlatforms:PS5'] },
        { filterBy: ['targetPlatforms:PS5'] },
      ),
    ]

    expect(filterOperationsByFinnishPs5EurScope(operations)).toHaveLength(1)
  })

  it('filters out non-PS5 or non-EUR operations', () => {
    const operations = [
      makeOperation(
        { targetPlatforms: ['PS4'], locale: 'fi-fi', currencyCode: 'EUR' },
        { targetPlatforms: ['PS4'], locale: 'fi-fi', currencyCode: 'EUR' },
      ),
      makeOperation(
        { targetPlatforms: ['PS5'], locale: 'fi-fi', currencyCode: 'USD' },
        { targetPlatforms: ['PS5'], locale: 'fi-fi', currencyCode: 'USD' },
      ),
    ]

    expect(filterOperationsByFinnishPs5EurScope(operations)).toHaveLength(0)
  })
})
