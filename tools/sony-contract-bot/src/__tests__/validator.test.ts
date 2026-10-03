import { describe, expect, it } from 'vitest'
import type {
  ContractFeature,
  ContractOperation,
  SonyContractManifest,
} from '../contract/types.js'
import { validateManifest } from '../contract/validator.js'

const gridFeatures: ContractFeature[] = ['new', 'upcoming', 'discounted']

const gridOperation = (feature: ContractFeature): ContractOperation => ({
  feature,
  operation_name: 'categoryGridRetrieve',
  persisted_query_hash: 'a'.repeat(64),
  required_headers: ['x-apollo-operation-name'],
  variables_schema: { id: 'string' },
  sample_variables: { id: 'x' },
  response_path: 'data.categoryGridRetrieve.products',
  observed_status_codes: [200],
})

// The `details` feature means the PDP operation `metGetProductById`.
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
  operations: [...gridFeatures.map(gridOperation), pdpOperation],
}

describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    expect(() => {
      validateManifest(validManifest)
    }).not.toThrow()
  })

  it('rejects missing feature coverage', () => {
    const invalid: SonyContractManifest = {
      ...validManifest,
      operations: validManifest.operations.filter(
        (op) => op.feature !== 'details',
      ),
    }

    expect(() => {
      validateManifest(invalid)
    }).toThrow(/Missing required feature mapping/)
  })

  it('rejects two operations with the same identity and different variables', () => {
    const duplicate: SonyContractManifest = {
      ...validManifest,
      operations: [
        ...validManifest.operations,
        {
          ...gridOperation('new'),
          variables_schema: { id: 'string', filterBy: [] },
        },
      ],
    }

    expect(() => {
      validateManifest(duplicate)
    }).toThrow(
      /Duplicate operation identity detected: new:categoryGridRetrieve/,
    )
  })
})
