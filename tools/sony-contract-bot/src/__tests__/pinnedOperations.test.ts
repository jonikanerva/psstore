import { describe, expect, it, vi } from 'vitest'
import { validateBackendCompatibility } from '../compat/backend.js'
import { normalizeOperations } from '../contract/normalizer.js'
import { createManifest } from '../contract/manifest.js'
import { addPinnedOperations } from '../contract/pinnedOperations.js'
import type { ContractOperation } from '../contract/types.js'
import { validateManifest } from '../contract/validator.js'

const GRID_HASH = 'a'.repeat(64)
const PDP_HASH = 'b'.repeat(64)
const PRICE_HASH = 'd'.repeat(64)

const operation = (
  feature: ContractOperation['feature'],
  name: string,
  hash: string,
  path: string,
  variables: Record<string, unknown>,
): ContractOperation => ({
  feature,
  operation_name: name,
  persisted_query_hash: hash,
  required_headers: ['x-apollo-operation-name'],
  variables_schema: Object.fromEntries(
    Object.keys(variables).map((key) => [key, 'string']),
  ),
  sample_variables: variables,
  response_path: path,
  observed_status_codes: [200],
})

const grid = (feature: ContractOperation['feature']) =>
  operation(
    feature,
    'categoryGridRetrieve',
    GRID_HASH,
    'data.categoryGridRetrieve.products',
    { id: 'x' },
  )
const price = operation(
  'details',
  'productRetrieveForCtasWithPrice',
  PRICE_HASH,
  'data.productRetrieve',
  { productId: 'P' },
)
const pdp = operation(
  'details',
  'metGetProductById',
  'c'.repeat(64),
  'data.productRetrieve',
  { productId: 'EP9000-PPSA01341_00-DEMONSSOULS00000' },
)

const envText = [
  'export const SONY_GRAPHQL_URL =',
  "  'https://web.np.playstation.com/api/graphql/v1/op'",
  "export const SONY_OPERATION_NAME = 'categoryGridRetrieve'",
  "export const SONY_PRODUCT_OPERATION_NAME = 'metGetProductById'",
  `export const SONY_PRODUCT_BY_ID_HASH =\n  '${PDP_HASH}'`,
  "export const SONY_PRODUCT_PRICE_OPERATION_NAME = 'productRetrieveForCtasWithPrice'",
  `export const SONY_PRODUCT_PRICE_HASH =\n  '${PRICE_HASH}'`,
].join('\n')

const captured = [grid('new'), grid('upcoming'), grid('discounted'), price]

describe('addPinnedOperations', () => {
  it('adds the pinned operation with the env hash when the probe passes', async () => {
    const probe = vi.fn().mockResolvedValue(undefined)
    const result = await addPinnedOperations(captured, [pdp], envText, probe)

    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith({
      url: 'https://web.np.playstation.com/api/graphql/v1/op',
      operationName: 'metGetProductById',
      hash: PDP_HASH,
      variables: { productId: 'EP9000-PPSA01341_00-DEMONSSOULS00000' },
    })
    const added = result.find(
      (entry) => entry.operation_name === 'metGetProductById',
    )
    expect(added?.persisted_query_hash).toBe(PDP_HASH)
  })

  it('yields a candidate manifest that passes validation and compatibility', async () => {
    const operations = normalizeOperations(
      await addPinnedOperations(
        captured,
        [pdp],
        envText,
        vi.fn().mockResolvedValue(undefined),
      ),
    )
    const manifest = createManifest(
      {
        capturedBy: 'test',
        endpointUrl: 'https://web.np.playstation.com/api/graphql/v1/op',
      },
      operations,
    )

    expect(() => {
      validateManifest(manifest)
    }).not.toThrow()
    expect(() => {
      validateBackendCompatibility(manifest, {
        serverEnvText: envText,
        sonyClientText:
          "'x-apollo-operation-name': strategy.operationName categoryGridRetrieve productRetrieve",
        mapperText: 'conceptToGame',
        serviceText: 'fetchConceptsByFeature',
      })
    }).not.toThrow()
  })

  it('fails with the operation, the hash and the runbook when the probe fails', async () => {
    const probe = vi
      .fn()
      .mockRejectedValue(new Error('PersistedQueryNotFound (hash rotated)'))

    await expect(
      addPinnedOperations(captured, [pdp], envText, probe),
    ).rejects.toThrow(
      /metGetProductById @ b{64} failed: PersistedQueryNotFound.*sony-graphql-runbook\.md, Failure handling/,
    )
  })

  it('does not probe when the capture holds the operation', async () => {
    const probe = vi.fn().mockResolvedValue(undefined)
    const result = await addPinnedOperations(
      [...captured, pdp],
      [pdp],
      envText,
      probe,
    )

    expect(probe).not.toHaveBeenCalled()
    expect(result).toHaveLength(captured.length + 1)
  })

  it('fails when the canonical manifest lacks the operation', async () => {
    const probe = vi.fn()
    await expect(
      addPinnedOperations(captured, [], envText, probe),
    ).rejects.toThrow(/not in the canonical manifest/)
    expect(probe).not.toHaveBeenCalled()
  })

  it('fails when the env constants are unreadable', async () => {
    await expect(
      addPinnedOperations(captured, [pdp], 'nothing', vi.fn()),
    ).rejects.toThrow(/SONY_GRAPHQL_URL/)
  })
})
