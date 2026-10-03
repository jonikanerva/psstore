import { describe, expect, it } from 'vitest'
import {
  filterTrackedOperations,
  TRACKED_OPERATIONS,
} from '../contract/trackedOperations.js'
import type { ContractOperation } from '../contract/types.js'

const operation = (operationName: string): ContractOperation => ({
  feature: 'details',
  operation_name: operationName,
  persisted_query_hash: 'a'.repeat(64),
  required_headers: ['x-apollo-operation-name'],
  variables_schema: {},
  sample_variables: {},
  response_path: 'data',
  observed_status_codes: [200],
})

describe('filterTrackedOperations', () => {
  it('keeps only the operations the server calls', () => {
    const names = [
      'categoryGridRetrieve',
      'metGetProductById',
      'productRetrieveForCtasWithPrice',
      'getSearchResults',
      'getPurchasedGameList',
      'storeRetrieveWishlist',
      'getDefaultView',
      'queryOracleUserProfileFullSubscription',
      'productRetrieveForUpsellWithCtas',
    ]

    expect(
      filterTrackedOperations(names.map(operation)).map(
        (entry) => entry.operation_name,
      ),
    ).toEqual(names.slice(0, 6))
  })

  it('never tracks a wishlist write operation', () => {
    expect(TRACKED_OPERATIONS).toContain('storeRetrieveWishlist')
    expect(TRACKED_OPERATIONS).not.toContain('removeWishlistItem')
    expect(filterTrackedOperations([operation('removeWishlistItem')])).toEqual(
      [],
    )
  })
})
