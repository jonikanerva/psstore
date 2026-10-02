import { describe, expect, it } from 'vitest'
import { parseCaptureRecordToOperation } from '../capture/parser.js'
import { createManifest } from '../contract/manifest.js'
import { normalizeOperations } from '../contract/normalizer.js'
import { operationIdentity } from '../contract/operationIdentity.js'
import { filterOperationsByFinnishPs5EurScope } from '../contract/scopeFilter.js'
import { filterTrackedOperations } from '../contract/trackedOperations.js'
import type { CaptureRecord, ContractFeature } from '../contract/types.js'
import { validateManifest } from '../contract/validator.js'

const GRID_HASH = 'a'.repeat(64)
const NOISE_HASH = 'f'.repeat(64)

const record = (
  operationName: string,
  hash: string,
  variables: Record<string, unknown>,
): CaptureRecord => {
  const url = new URL('https://web.np.playstation.com/api/graphql/v1/op')
  url.searchParams.set('operationName', operationName)
  url.searchParams.set('variables', JSON.stringify(variables))
  url.searchParams.set(
    'extensions',
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
  )
  return {
    method: 'GET',
    url: url.toString(),
    headers: {},
    status: 200,
    responseJson: { data: { categoryGridRetrieve: { products: [] } } },
  }
}

const gridVariables = (filterBy: string[]): Record<string, unknown> => ({
  id: 'd0446d4b-dc9a-4f1e-86ec-651f099c9b29',
  pageArgs: { size: 24, offset: 0 },
  sortBy: null,
  filterBy,
  facetOptions: [],
})

const captured: Array<[ContractFeature, CaptureRecord]> = [
  ['new', record('getDefaultView', NOISE_HASH, { categoryId: 'x' })],
  ['new', record('categoryGridRetrieve', GRID_HASH, gridVariables([]))],
  [
    'new',
    record(
      'categoryGridRetrieve',
      GRID_HASH,
      gridVariables(['targetPlatforms:PS5']),
    ),
  ],
  ['upcoming', record('categoryGridRetrieve', GRID_HASH, gridVariables([]))],
  [
    'upcoming',
    record(
      'categoryGridRetrieve',
      GRID_HASH,
      gridVariables(['targetPlatforms:PS5']),
    ),
  ],
  ['discounted', record('categoryGridRetrieve', GRID_HASH, gridVariables([]))],
  [
    'discounted',
    record(
      'categoryGridRetrieve',
      GRID_HASH,
      gridVariables(['targetPlatforms:PS5']),
    ),
  ],
  [
    'details',
    record('wcaProductStarRatingRetrive', NOISE_HASH, { productId: 'P' }),
  ],
  [
    'details',
    record('productRetrieveForCtasWithPrice', 'c'.repeat(64), {
      productId: 'P',
    }),
  ],
]

const parsed = captured.map(([feature, entry]) =>
  parseCaptureRecordToOperation(entry, feature),
)

const manifestFrom = (
  operations: ReturnType<typeof normalizeOperations>,
): ReturnType<typeof createManifest> =>
  createManifest(
    { capturedBy: 'test', endpointUrl: 'https://example.invalid/op' },
    operations,
  )

describe('capture to manifest pipeline', () => {
  it('collapses two grid requests that differ only in variables', () => {
    const grid = parsed.filter(
      (operation) =>
        operation.feature === 'new' &&
        operation.operation_name === 'categoryGridRetrieve',
    )
    expect(grid).toHaveLength(2)

    const result = normalizeOperations(grid)
    expect(result).toHaveLength(1)
    expect(result[0]?.sample_variables['filterBy']).toEqual([])
  })

  it('drops the unfiltered grid request and the noise operations', () => {
    const result = normalizeOperations(
      filterOperationsByFinnishPs5EurScope(filterTrackedOperations(parsed)),
    )

    expect(result.map(operationIdentity)).toEqual([
      `details:productRetrieveForCtasWithPrice:${'c'.repeat(64)}`,
      `discounted:categoryGridRetrieve:${GRID_HASH}`,
      `new:categoryGridRetrieve:${GRID_HASH}`,
      `upcoming:categoryGridRetrieve:${GRID_HASH}`,
    ])
    for (const operation of result.filter(
      (entry) => entry.operation_name === 'categoryGridRetrieve',
    )) {
      expect(operation.sample_variables['filterBy']).toEqual([
        'targetPlatforms:PS5',
      ])
    }
  })

  it('builds a manifest that passes validation once details has an operation', () => {
    const result = normalizeOperations(
      filterOperationsByFinnishPs5EurScope(filterTrackedOperations(parsed)),
    )
    expect(() => {
      validateManifest(manifestFrom(result))
    }).not.toThrow()
  })

  it('dedupes by the shared identity, first record wins', () => {
    const [first] = parsed.filter(
      (operation) => operation.operation_name === 'categoryGridRetrieve',
    )
    if (!first) throw new Error('fixture missing')
    const second = { ...first, sample_variables: { filterBy: ['other'] } }
    const result = normalizeOperations([first, second])
    expect(result).toHaveLength(1)
    expect(result[0]?.sample_variables).toEqual(first.sample_variables)
  })
})
