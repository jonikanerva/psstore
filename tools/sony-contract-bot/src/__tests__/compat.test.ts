import { describe, expect, it } from 'vitest'
import type {
  ContractFeature,
  ContractOperation,
  SonyContractManifest,
} from '../contract/types.js'
import { validateBackendCompatibility } from '../compat/backend.js'
import type { SonyConstants } from '../contract/sonyConstants.js'

const GRID_FEATURES: ContractFeature[] = ['new', 'upcoming', 'discounted']
const GRID_HASH = 'a'.repeat(64)
const PDP_HASH = 'b'.repeat(64)
const PRICE_HASH = 'd'.repeat(64)
const SEARCH_HASH = 'f'.repeat(64)
const PURCHASED_HASH = '9'.repeat(64)
const WISHLIST_HASH = '7'.repeat(64)

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
  variables_schema: {
    isActive: 'boolean',
    platform: ['string'],
    size: 'number',
    sortBy: 'string',
    sortDirection: 'string',
    start: 'number',
  },
  sample_variables: {
    isActive: true,
    platform: ['ps5'],
    size: 100,
    sortBy: 'ACTIVE_DATE',
    sortDirection: 'desc',
    start: 0,
  },
  response_path: 'data.purchasedTitlesRetrieve.games',
  observed_status_codes: [],
})

const wishlistOperation = (): ContractOperation => ({
  feature: 'wishlist',
  operation_name: 'storeRetrieveWishlist',
  persisted_query_hash: WISHLIST_HASH,
  required_headers: ['x-apollo-operation-name'],
  variables_schema: {},
  sample_variables: {},
  response_path: 'data.storeWishlistSecure',
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
    wishlistOperation(),
  ],
}

// The constants that the bot reads from docs/contracts/sony-constants.json.
const constantValues: Record<string, string> = {
  SONY_GRAPHQL_URL: 'https://web.np.playstation.com/api/graphql/v1/op',
  SONY_OPERATION_NAME: 'categoryGridRetrieve',
  SONY_PRODUCT_OPERATION_NAME: 'metGetProductById',
  SONY_PRODUCT_BY_ID_HASH: PDP_HASH,
  SONY_PRODUCT_PRICE_OPERATION_NAME: 'productRetrieveForCtasWithPrice',
  SONY_PRODUCT_PRICE_HASH: PRICE_HASH,
  SONY_SEARCH_OPERATION_NAME: 'getSearchResults',
  SONY_SEARCH_HASH: SEARCH_HASH,
  SONY_PURCHASED_OPERATION_NAME: 'getPurchasedGameList',
  SONY_PURCHASED_HASH: PURCHASED_HASH,
  SONY_WISHLIST_OPERATION_NAME: 'storeRetrieveWishlist',
  SONY_WISHLIST_HASH: WISHLIST_HASH,
}

const sonyConstants: SonyConstants = new Map(Object.entries(constantValues))

// The constants without the named keys.
const constantsWithout = (...names: string[]): SonyConstants =>
  new Map([...sonyConstants].filter(([name]) => !names.includes(name)))

// Production lines of the Rust server that hold each source anchor.
const sonyClientText = [
  '.header("x-apollo-operation-name", operation)',
  '.get("categoryGridRetrieve")',
  '.get("productRetrieve")',
  'Ok(data) => data.get("universalSearch"),',
  '&contract.purchased_hash,',
  '&contract.wishlist_hash,',
].join('\n')

const context = {
  sonyConstants,
  sonyClientText,
  mapperText:
    'pub fn concept_to_game(concept: &Concept, now_ms: i64) -> Game {',
  serviceText: 'sony.concepts_by_feature(feature, size, 0)',
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
        wishlistOperation(),
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
        wishlistOperation(),
      ],
    }

    expect(() => {
      validateBackendCompatibility(wrongVars, context)
    }).toThrow(/Product operation .* variables_schema incompatible/)
  })

  it('rejects when the Sony client no longer extracts productRetrieve (cut 3)', () => {
    // Prove the source-side guard can actually fail: a Sony client text that
    // still reads the grid path but no longer reads `productRetrieve`.
    const withoutProductRetrieve = {
      ...context,
      sonyClientText: sonyClientText.replace('.get("productRetrieve")', ''),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutProductRetrieve)
    }).toThrow(/productRetrieve/)
  })

  it('rejects when the PDP constants are missing', () => {
    const withoutPdpConstants = {
      ...context,
      sonyConstants: constantsWithout(
        'SONY_PRODUCT_OPERATION_NAME',
        'SONY_PRODUCT_BY_ID_HASH',
      ),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutPdpConstants)
    }).toThrow(/SONY_PRODUCT_OPERATION_NAME.*sony-constants\.json/)
  })

  it('rejects when the endpoint constants are missing', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyConstants: constantsWithout('SONY_GRAPHQL_URL'),
      })
    }).toThrow(/SONY_GRAPHQL_URL.*sony-constants\.json/)
  })

  it('treats an empty constant value as missing', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyConstants: new Map([...sonyConstants, ['SONY_OPERATION_NAME', '']]),
      })
    }).toThrow(/SONY_OPERATION_NAME/)
  })

  it('rejects a manifest without the price operation', () => {
    const withoutPrice: SonyContractManifest = {
      ...manifest,
      operations: [...GRID_FEATURES.map(gridOperation), pdpOperation()],
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
      ],
    }

    expect(() => {
      validateBackendCompatibility(rotated, context)
    }).toThrow(/Manifest missing price operation/)
  })

  it('rejects when the price constants are missing', () => {
    const withoutPriceConstants = {
      ...context,
      sonyConstants: constantsWithout('SONY_PRODUCT_PRICE_HASH'),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutPriceConstants)
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

  it('rejects when the Sony client no longer extracts universalSearch', () => {
    const withoutSearchPath = {
      ...context,
      sonyClientText: sonyClientText.replace('"universalSearch"', ''),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutSearchPath)
    }).toThrow(/universalSearch/)
  })

  it('rejects when the search constants are missing', () => {
    const withoutSearchConstants = {
      ...context,
      sonyConstants: constantsWithout(
        'SONY_SEARCH_OPERATION_NAME',
        'SONY_SEARCH_HASH',
      ),
    }

    expect(() => {
      validateBackendCompatibility(manifest, withoutSearchConstants)
    }).toThrow(/SONY_SEARCH_OPERATION_NAME/)
  })
  const withoutPurchased = () =>
    manifest.operations.filter((op) => op.feature !== 'purchased')

  it('accepts the library operation', () => {
    expect(manifest.operations.some((op) => op.feature === 'purchased')).toBe(
      true,
    )
    expect(() => {
      validateBackendCompatibility(manifest, context)
    }).not.toThrow()
  })

  it('rejects a manifest without the library operation', () => {
    expect(() => {
      validateBackendCompatibility(
        { ...manifest, operations: withoutPurchased() },
        context,
      )
    }).toThrow(/Manifest missing library operation/)
  })

  it('rejects a library operation whose hash does not match the server', () => {
    expect(() => {
      validateBackendCompatibility(
        {
          ...manifest,
          operations: [
            ...withoutPurchased(),
            { ...purchasedOperation(), persisted_query_hash: '8'.repeat(64) },
          ],
        },
        context,
      )
    }).toThrow(/Manifest missing library operation/)
  })

  it('rejects a library operation with the wrong response_path', () => {
    expect(() => {
      validateBackendCompatibility(
        {
          ...manifest,
          operations: [
            ...withoutPurchased(),
            { ...purchasedOperation(), response_path: 'data.productRetrieve' },
          ],
        },
        context,
      )
    }).toThrow(/Library operation .* response path incompatible/)
  })

  it('rejects a library operation with the wrong variables_schema', () => {
    expect(() => {
      validateBackendCompatibility(
        {
          ...manifest,
          operations: [
            ...withoutPurchased(),
            {
              ...purchasedOperation(),
              variables_schema: { size: 'number' },
            },
          ],
        },
        context,
      )
    }).toThrow(/Library operation .* variables_schema incompatible/)
  })

  it('rejects when the Sony client no longer sends the library hash constant', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyClientText: sonyClientText.replace('contract.purchased_hash', ''),
      })
    }).toThrow(/SONY_PURCHASED_HASH, contract\.purchased_hash/)
  })

  it('rejects when the library constants are missing', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyConstants: constantsWithout('SONY_PURCHASED_OPERATION_NAME'),
      })
    }).toThrow(/SONY_PURCHASED_OPERATION_NAME/)
  })
})

describe('wishlist operation compatibility', () => {
  const withoutWishlist = () =>
    manifest.operations.filter((op) => op.feature !== 'wishlist')

  it('accepts the wishlist operation', () => {
    expect(() => {
      validateBackendCompatibility(manifest, context)
    }).not.toThrow()
  })

  it('rejects a manifest without the wishlist operation', () => {
    expect(() => {
      validateBackendCompatibility(
        { ...manifest, operations: withoutWishlist() },
        context,
      )
    }).toThrow(/Manifest missing wishlist operation/)
  })

  it('rejects a wishlist operation whose hash does not match the server', () => {
    expect(() => {
      validateBackendCompatibility(
        {
          ...manifest,
          operations: [
            ...withoutWishlist(),
            { ...wishlistOperation(), persisted_query_hash: '6'.repeat(64) },
          ],
        },
        context,
      )
    }).toThrow(/Manifest missing wishlist operation/)
  })

  it('rejects a wishlist operation with the wrong response_path', () => {
    expect(() => {
      validateBackendCompatibility(
        {
          ...manifest,
          operations: [
            ...withoutWishlist(),
            { ...wishlistOperation(), response_path: 'data.productRetrieve' },
          ],
        },
        context,
      )
    }).toThrow(/Wishlist operation .* response path incompatible/)
  })

  it('rejects a wishlist operation that declares variables', () => {
    expect(() => {
      validateBackendCompatibility(
        {
          ...manifest,
          operations: [
            ...withoutWishlist(),
            {
              ...wishlistOperation(),
              variables_schema: { id: 'string' },
            },
          ],
        },
        context,
      )
    }).toThrow(/Wishlist operation .* variables_schema incompatible/)
  })

  it('rejects when the Sony client no longer sends the wishlist hash constant', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyClientText: sonyClientText.replace('contract.wishlist_hash', ''),
      })
    }).toThrow(/SONY_WISHLIST_HASH, contract\.wishlist_hash/)
  })

  it('rejects when the wishlist constants are missing', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyConstants: constantsWithout('SONY_WISHLIST_OPERATION_NAME'),
      })
    }).toThrow(/SONY_WISHLIST_OPERATION_NAME/)
  })
})

describe('source anchors', () => {
  it.each([
    [
      'the operation-name header',
      '"x-apollo-operation-name"',
      /x-apollo-operation-name/,
    ],
    ['the grid path', '"categoryGridRetrieve"', /categoryGridRetrieve/],
  ])('rejects a Sony client without %s', (_name, anchor, message) => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyClientText: sonyClientText.replace(anchor, ''),
      })
    }).toThrow(message)
  })

  it('rejects a mapper without the concept mapping', () => {
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        mapperText: 'pub fn product_detail_to_game() {}',
      })
    }).toThrow(/fn concept_to_game/)
  })

  it('rejects a games service that only declares the concept fetch', () => {
    // The port trait declares the method. Only a call counts.
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        serviceText: 'fn concepts_by_feature(&self, feature: SonyFeature)',
      })
    }).toThrow(/games service no longer fetches feature concepts/)
  })

  it('rejects an anchor in another quoting or as a bare word', () => {
    // A comment that names the path does not count: the anchor is the quoted
    // string literal that the code reads.
    expect(() => {
      validateBackendCompatibility(manifest, {
        ...context,
        sonyClientText: sonyClientText.replace(
          '"productRetrieve"',
          '// reads productRetrieve',
        ),
      })
    }).toThrow(/productRetrieve/)
  })
})
