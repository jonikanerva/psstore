import { describe, expect, it } from 'vitest'
import type {
  ContractFeature,
  ContractOperation,
  SonyContractManifest,
} from '../contract/types.js'
import { validateBackendCompatibility } from '../compat/backend.js'

const GRID_FEATURES: ContractFeature[] = ['new', 'upcoming', 'discounted']
const GRID_HASH = 'a'.repeat(64)
const PDP_HASH = 'b'.repeat(64)

const gridOperation = (feature: ContractFeature): ContractOperation => ({
  feature,
  operation_name: 'categoryGridRetrieve',
  persisted_query_hash: GRID_HASH,
  required_headers: ['x-apollo-operation-name'],
  variables_schema: { id: 'string' },
  sample_variables: { id: 'x' },
  response_path: 'data.categoryGridRetrieve.products',
  observed_status_codes: [200],
})

// The `details` feature MEANS the PDP operation `metGetProductById`.
const pdpOperation = (): ContractOperation => ({
  feature: 'details',
  operation_name: 'metGetProductById',
  persisted_query_hash: PDP_HASH,
  required_headers: ['x-apollo-operation-name'],
  variables_schema: { productId: 'string' },
  sample_variables: { productId: 'EP9000-PPSA01341_00-DEMONSSOULS00000' },
  response_path: 'data.productRetrieve',
  observed_status_codes: [200],
})

const baseMetadata = {
  captured_at: '2026-02-17T00:00:00.000Z',
  captured_by: 'codex',
  region: 'fi' as const,
  locale: 'fi-fi' as const,
  currency: 'EUR' as const,
  target_platform: 'PS5' as const,
  playwright_profile: 'default',
}

const endpoint = {
  url: 'https://web.np.playstation.com/api/graphql/v1/op',
  method: 'GET',
}

// A correct manifest: three grid ops plus the PDP `details` op.
const manifest: SonyContractManifest = {
  version: 1,
  metadata: baseMetadata,
  endpoint,
  operations: [...GRID_FEATURES.map(gridOperation), pdpOperation()],
}

// serverEnvText declares all four anchored constants the backend exposes,
// including the PDP operation name + hash (server/src/config/env.ts).
const serverEnvText = [
  'export const SONY_GRAPHQL_URL =',
  "  'https://web.np.playstation.com/api/graphql/v1/op'",
  "export const SONY_OPERATION_NAME = 'categoryGridRetrieve'",
  "export const SONY_PRODUCT_OPERATION_NAME = 'metGetProductById'",
  `export const SONY_PRODUCT_BY_ID_HASH =\n  '${PDP_HASH}'`,
].join('\n')

const context = {
  serverEnvText,
  sonyClientText:
    "headers: { 'x-apollo-operation-name': strategy.operationName }\nreturn json.data?.categoryGridRetrieve?.concepts ?? []\nconst product = json.data?.productRetrieve",
  mapperText: 'export const conceptToGame = (concept) => concept',
  serviceText: "await fetchConceptsByFeature('new', 300)",
}

describe('validateBackendCompatibility', () => {
  it('accepts a compatible manifest with the PDP details operation', () => {
    expect(() => {
      validateBackendCompatibility(manifest, context)
    }).not.toThrow()
  })

  it("rejects today's all-grid manifest where details is still categoryGridRetrieve", () => {
    // With `details` wired to the grid op, no entry matches the PDP operation,
    // so the PDP coverage is missing and compat must fail.
    const allGrid: SonyContractManifest = {
      ...manifest,
      operations: [...GRID_FEATURES, 'details' as const].map(gridOperation),
    }

    expect(() => {
      validateBackendCompatibility(allGrid, context)
    }).toThrow(/Manifest missing PDP operation/)
  })

  it('rejects a manifest whose PDP hash does not match the server', () => {
    const rotated: SonyContractManifest = {
      ...manifest,
      operations: [
        ...GRID_FEATURES.map(gridOperation),
        { ...pdpOperation(), persisted_query_hash: 'c'.repeat(64) },
      ],
    }

    expect(() => {
      validateBackendCompatibility(rotated, context)
    }).toThrow(/Manifest missing PDP operation/)
  })

  it('rejects a PDP operation with the wrong response_path', () => {
    const wrongPath: SonyContractManifest = {
      ...manifest,
      operations: [
        ...GRID_FEATURES.map(gridOperation),
        {
          ...pdpOperation(),
          response_path: 'data.categoryGridRetrieve.products',
        },
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongPath, context)
    }).toThrow(/PDP operation .* response path incompatible/)
  })

  it('rejects a PDP operation with the wrong variables_schema', () => {
    const wrongVars: SonyContractManifest = {
      ...manifest,
      operations: [
        ...GRID_FEATURES.map(gridOperation),
        { ...pdpOperation(), variables_schema: { conceptId: 'string' } },
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongVars, context)
    }).toThrow(/PDP operation .* variables_schema incompatible/)
  })

  it('rejects when sonyClient no longer extracts productRetrieve (cut 3)', () => {
    // Prove the source-side guard can actually fail: a sonyClient text that
    // still reads the grid path but no longer reads `productRetrieve`.
    const withoutProductRetrieve = {
      ...context,
      sonyClientText:
        "headers: { 'x-apollo-operation-name': strategy.operationName }\nreturn json.data?.categoryGridRetrieve?.concepts ?? []",
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutProductRetrieve)
    }).toThrow(/productRetrieve/)
  })

  it('rejects when the server PDP env constants are unreadable', () => {
    const withoutPdpEnv = {
      ...context,
      serverEnvText: [
        'export const SONY_GRAPHQL_URL =',
        "  'https://web.np.playstation.com/api/graphql/v1/op'",
        "export const SONY_OPERATION_NAME = 'categoryGridRetrieve'",
      ].join('\n'),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutPdpEnv)
    }).toThrow(/SONY_PRODUCT_OPERATION_NAME/)
  })
})
