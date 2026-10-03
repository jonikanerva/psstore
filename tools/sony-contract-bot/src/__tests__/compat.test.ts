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
const PRICE_HASH = 'd'.repeat(64)
const SEARCH_HASH = 'f'.repeat(64)
const PURCHASED_HASH = '9'.repeat(64)

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

const priceOperation = (): ContractOperation => ({
  ...pdpOperation(),
  operation_name: 'productRetrieveForCtasWithPrice',
  persisted_query_hash: PRICE_HASH,
})

const searchOperation = (): ContractOperation => ({
  feature: 'search',
  operation_name: 'getSearchResults',
  persisted_query_hash: SEARCH_HASH,
  required_headers: ['x-apollo-operation-name'],
  variables_schema: {
    countryCode: 'string',
    languageCode: 'string',
    nextCursor: 'string',
    pageOffset: 'number',
    pageSize: 'number',
    searchTerm: 'string',
  },
  sample_variables: {
    countryCode: 'FI',
    languageCode: 'en',
    nextCursor: '',
    pageOffset: 0,
    pageSize: 24,
    searchTerm: 'elden',
  },
  response_path: 'data.universalSearch',
  observed_status_codes: [200],
})

const purchasedOperation = (): ContractOperation => ({
  feature: 'purchased',
  operation_name: 'getPurchasedGameList',
  persisted_query_hash: PURCHASED_HASH,
  required_headers: ['x-apollo-operation-name'],
  variables_schema: { size: 'number' },
  sample_variables: { size: 100 },
  response_path: 'data.purchasedTitlesRetrieve.games',
  observed_status_codes: [],
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
  operations: [
    ...GRID_FEATURES.map(gridOperation),
    pdpOperation(),
    priceOperation(),
    searchOperation(),
    purchasedOperation(),
  ],
}

// serverEnvText declares all four anchored constants the backend exposes,
// including the PDP operation name + hash (server/src/config/env.ts).
const serverEnvText = [
  'export const SONY_GRAPHQL_URL =',
  "  'https://web.np.playstation.com/api/graphql/v1/op'",
  "export const SONY_OPERATION_NAME = 'categoryGridRetrieve'",
  "export const SONY_PRODUCT_OPERATION_NAME = 'metGetProductById'",
  `export const SONY_PRODUCT_BY_ID_HASH =\n  '${PDP_HASH}'`,
  "export const SONY_PRODUCT_PRICE_OPERATION_NAME = 'productRetrieveForCtasWithPrice'",
  `export const SONY_PRODUCT_PRICE_HASH =\n  '${PRICE_HASH}'`,
  "export const SONY_SEARCH_OPERATION_NAME = 'getSearchResults'",
  `export const SONY_SEARCH_HASH =\n  '${SEARCH_HASH}'`,
  "export const SONY_PURCHASED_OPERATION_NAME = 'getPurchasedGameList'",
  `export const SONY_PURCHASED_HASH =\n  '${PURCHASED_HASH}'`,
].join('\n')

const context = {
  serverEnvText,
  sonyClientText:
    "headers: { 'x-apollo-operation-name': strategy.operationName }\nreturn json.data?.categoryGridRetrieve?.concepts ?? []\nconst product = json.data?.productRetrieve\nconst search = json.data?.universalSearch",
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
        priceOperation(),
        purchasedOperation(),
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
        priceOperation(),
        searchOperation(),
        purchasedOperation(),
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongPath, context)
    }).toThrow(/Product operation .* response path incompatible/)
  })

  it('rejects a PDP operation with the wrong variables_schema', () => {
    const wrongVars: SonyContractManifest = {
      ...manifest,
      operations: [
        ...GRID_FEATURES.map(gridOperation),
        { ...pdpOperation(), variables_schema: { conceptId: 'string' } },
        priceOperation(),
        searchOperation(),
        purchasedOperation(),
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongVars, context)
    }).toThrow(/Product operation .* variables_schema incompatible/)
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

  it('rejects a manifest without the price operation', () => {
    const withoutPrice: SonyContractManifest = {
      ...manifest,
      operations: [
        ...GRID_FEATURES.map(gridOperation),
        pdpOperation(),
        purchasedOperation(),
      ],
    }

    expect(() => {
      validateBackendCompatibility(withoutPrice, context)
    }).toThrow(/Manifest missing price operation/)
  })

  it('rejects a manifest whose price hash does not match the server', () => {
    const rotated: SonyContractManifest = {
      ...manifest,
      operations: [
        ...GRID_FEATURES.map(gridOperation),
        pdpOperation(),
        { ...priceOperation(), persisted_query_hash: 'e'.repeat(64) },
        purchasedOperation(),
      ],
    }

    expect(() => {
      validateBackendCompatibility(rotated, context)
    }).toThrow(/Manifest missing price operation/)
  })

  it('rejects when the server price env constants are unreadable', () => {
    const withoutPriceEnv = {
      ...context,
      serverEnvText: serverEnvText
        .split('\n')
        .filter((line) => !line.includes('SONY_PRODUCT_PRICE'))
        .join('\n')
        .replace(/\n\s*'d{64}'/, ''),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutPriceEnv)
    }).toThrow(/SONY_PRODUCT_PRICE_OPERATION_NAME/)
  })

  it('rejects a manifest without the search operation', () => {
    const withoutSearch: SonyContractManifest = {
      ...manifest,
      operations: manifest.operations.filter((op) => op.feature !== 'search'),
    }

    expect(() => {
      validateBackendCompatibility(withoutSearch, context)
    }).toThrow(/Manifest missing search operation/)
  })

  it('rejects a manifest whose search hash does not match the server', () => {
    const rotated: SonyContractManifest = {
      ...manifest,
      operations: [
        ...manifest.operations.filter((op) => op.feature !== 'search'),
        { ...searchOperation(), persisted_query_hash: 'e'.repeat(64) },
      ],
    }

    expect(() => {
      validateBackendCompatibility(rotated, context)
    }).toThrow(/Manifest missing search operation/)
  })

  it('rejects a search operation with the wrong response_path', () => {
    const wrongPath: SonyContractManifest = {
      ...manifest,
      operations: [
        ...manifest.operations.filter((op) => op.feature !== 'search'),
        { ...searchOperation(), response_path: 'data.productRetrieve' },
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongPath, context)
    }).toThrow(/Search operation .* response path incompatible/)
  })

  it('rejects a search operation with the wrong variables_schema', () => {
    const wrongVars: SonyContractManifest = {
      ...manifest,
      operations: [
        ...manifest.operations.filter((op) => op.feature !== 'search'),
        { ...searchOperation(), variables_schema: { searchTerm: 'string' } },
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongVars, context)
    }).toThrow(/Search operation .* variables_schema incompatible/)
  })

  it('rejects when sonyClient no longer extracts universalSearch', () => {
    const withoutSearchPath = {
      ...context,
      sonyClientText: context.sonyClientText.replace('universalSearch', ''),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutSearchPath)
    }).toThrow(/universalSearch/)
  })

  it('rejects when the server search env constants are unreadable', () => {
    const withoutSearchEnv = {
      ...context,
      serverEnvText: serverEnvText
        .split('\n')
        .filter((line) => !line.includes('SONY_SEARCH'))
        .join('\n')
        .replace(/\n\s*'f{64}'/, ''),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutSearchEnv)
    }).toThrow(/SONY_SEARCH_OPERATION_NAME/)
  })

  it('rejects a manifest without the purchased operation', () => {
    const withoutPurchased: SonyContractManifest = {
      ...manifest,
      operations: manifest.operations.filter(
        (op) => op.feature !== 'purchased',
      ),
    }

    expect(() => {
      validateBackendCompatibility(withoutPurchased, context)
    }).toThrow(/Manifest missing purchased operation/)
  })

  it('rejects a manifest whose purchased hash does not match the server', () => {
    const rotated: SonyContractManifest = {
      ...manifest,
      operations: [
        ...manifest.operations.filter((op) => op.feature !== 'purchased'),
        { ...purchasedOperation(), persisted_query_hash: '1'.repeat(64) },
      ],
    }

    expect(() => {
      validateBackendCompatibility(rotated, context)
    }).toThrow(/Manifest missing purchased operation/)
  })

  it('rejects when the server purchased env constants are unreadable', () => {
    const withoutPurchasedEnv = {
      ...context,
      serverEnvText: serverEnvText
        .split('\n')
        .filter((line) => !line.includes('SONY_PURCHASED'))
        .join('\n')
        .replace(/\n\s*'9{64}'/, ''),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutPurchasedEnv)
    }).toThrow(/SONY_PURCHASED_OPERATION_NAME/)
  })
})
