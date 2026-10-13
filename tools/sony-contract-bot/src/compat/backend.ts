import {
  SONY_CONSTANTS_FILE,
  sonyConstant,
  type SonyConstants,
} from '../contract/sonyConstants.js'
import type { SonyContractManifest } from '../contract/types.js'

// The inputs of the compatibility check. The constants come from
// `docs/contracts/sony-constants.json`. The three texts are the production
// code of the server: the Sony client sources, the mapper, and the games
// service (see `rustSources.ts`).
export interface CompatibilityContext {
  sonyConstants: SonyConstants
  sonyClientText: string
  mapperText: string
  serviceText: string
}

// The PDP request variable shape the manifest must record. The bot's parser
// emits `jsonType({ productId: '<id>' })` → `{ productId: 'string' }`, so the
// committed manifest's `variables_schema` for the PDP op must equal this.
const PDP_VARIABLES_SCHEMA: Record<string, unknown> = { productId: 'string' }

// Order-insensitive structural equality of two contract variable schemas via a
// canonically-keyed JSON string. Avoids an `as` cast (STACK.md §8) — both sides
// are already `Record<string, unknown>`, and the schemas are flat key→type maps,
// so a key-sorted JSON comparison is sound and deterministic.
const canonicalJson = (value: Record<string, unknown>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  )

const variablesSchemaEquals = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => canonicalJson(left) === canonicalJson(right)

// The search request variable shape the manifest must record: the term, the
// page window, and the fixed store scope.
const SEARCH_VARIABLES_SCHEMA: Record<string, unknown> = {
  countryCode: 'string',
  languageCode: 'string',
  nextCursor: 'string',
  pageOffset: 'number',
  pageSize: 'number',
  searchTerm: 'string',
}

// The signed-in library request variable shape the manifest must record. It
// mirrors the variables the server sends (`PurchasedVariables` in the
// server's Sony account client).
const PURCHASED_VARIABLES_SCHEMA: Record<string, unknown> = {
  isActive: 'boolean',
  platform: ['string'],
  size: 'number',
  sortBy: 'string',
  sortDirection: 'string',
  start: 'number',
}

export const validateBackendCompatibility = (
  manifest: SonyContractManifest,
  context: CompatibilityContext,
): void => {
  // Defensive runtime check at the trust boundary: the manifest schema
  // narrows these to literal types, so TypeScript treats the comparisons as
  // dead. We keep the guard because the manifest is read from disk and Zod
  // could be bypassed by a future caller; do not remove without re-auditing.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive runtime guard at trust boundary; see comment above */
  if (
    manifest.metadata.region !== 'fi' ||
    manifest.metadata.locale !== 'fi-fi' ||
    manifest.metadata.currency !== 'EUR' ||
    manifest.metadata.target_platform !== 'PS5'
  ) {
    throw new Error('Manifest metadata must be fixed to fi / fi-fi / EUR / PS5')
  }
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  const expectedOperationName = sonyConstant(
    context.sonyConstants,
    'SONY_OPERATION_NAME',
  )
  const expectedEndpoint = sonyConstant(
    context.sonyConstants,
    'SONY_GRAPHQL_URL',
  )
  // The PDP operation feeds both the product-detail page AND the
  // NEW/DISCOUNTED release-date + classification enrichment (the games
  // service). Anchor compatibility on the same two constants that the server
  // reads from the constants file.
  const expectedProductOperationName = sonyConstant(
    context.sonyConstants,
    'SONY_PRODUCT_OPERATION_NAME',
  )
  const expectedProductHash = sonyConstant(
    context.sonyConstants,
    'SONY_PRODUCT_BY_ID_HASH',
  )

  const expectedPriceOperationName = sonyConstant(
    context.sonyConstants,
    'SONY_PRODUCT_PRICE_OPERATION_NAME',
  )
  const expectedPriceHash = sonyConstant(
    context.sonyConstants,
    'SONY_PRODUCT_PRICE_HASH',
  )

  const expectedSearchOperationName = sonyConstant(
    context.sonyConstants,
    'SONY_SEARCH_OPERATION_NAME',
  )
  const expectedSearchHash = sonyConstant(
    context.sonyConstants,
    'SONY_SEARCH_HASH',
  )

  const expectedPurchasedOperationName = sonyConstant(
    context.sonyConstants,
    'SONY_PURCHASED_OPERATION_NAME',
  )
  const expectedPurchasedHash = sonyConstant(
    context.sonyConstants,
    'SONY_PURCHASED_HASH',
  )

  const expectedWishlistOperationName = sonyConstant(
    context.sonyConstants,
    'SONY_WISHLIST_OPERATION_NAME',
  )
  const expectedWishlistHash = sonyConstant(
    context.sonyConstants,
    'SONY_WISHLIST_HASH',
  )

  if (!expectedOperationName || !expectedEndpoint) {
    throw new Error(
      `Unable to read SONY_OPERATION_NAME / SONY_GRAPHQL_URL from ${SONY_CONSTANTS_FILE} for compatibility checks`,
    )
  }

  if (!expectedProductOperationName || !expectedProductHash) {
    throw new Error(
      `Unable to read the PDP constants (SONY_PRODUCT_OPERATION_NAME / SONY_PRODUCT_BY_ID_HASH) from ${SONY_CONSTANTS_FILE} for compatibility checks`,
    )
  }

  if (!expectedPriceOperationName || !expectedPriceHash) {
    throw new Error(
      `Unable to read the price constants (SONY_PRODUCT_PRICE_OPERATION_NAME / SONY_PRODUCT_PRICE_HASH) from ${SONY_CONSTANTS_FILE} for compatibility checks`,
    )
  }

  if (!expectedSearchOperationName || !expectedSearchHash) {
    throw new Error(
      `Unable to read the search constants (SONY_SEARCH_OPERATION_NAME / SONY_SEARCH_HASH) from ${SONY_CONSTANTS_FILE} for compatibility checks`,
    )
  }

  if (!expectedPurchasedOperationName || !expectedPurchasedHash) {
    throw new Error(
      `Unable to read the library constants (SONY_PURCHASED_OPERATION_NAME / SONY_PURCHASED_HASH) from ${SONY_CONSTANTS_FILE} for compatibility checks`,
    )
  }

  if (!expectedWishlistOperationName || !expectedWishlistHash) {
    throw new Error(
      `Unable to read the wishlist constants (SONY_WISHLIST_OPERATION_NAME / SONY_WISHLIST_HASH) from ${SONY_CONSTANTS_FILE} for compatibility checks`,
    )
  }

  if (
    !manifest.operations.some(
      (operation) => operation.operation_name === expectedOperationName,
    )
  ) {
    throw new Error(
      `Manifest missing operation_name compatible with server: ${expectedOperationName}`,
    )
  }

  // Require a manifest entry that matches the PDP operation name AND the
  // server's current persisted-query hash. A rotated PDP hash (constants file
  // updated, manifest stale, or vice versa) fails here.
  if (
    !manifest.operations.some(
      (operation) =>
        operation.operation_name === expectedProductOperationName &&
        operation.persisted_query_hash === expectedProductHash,
    )
  ) {
    throw new Error(
      `Manifest missing PDP operation compatible with server: ${expectedProductOperationName} @ ${expectedProductHash}`,
    )
  }

  if (
    !manifest.operations.some(
      (operation) =>
        operation.operation_name === expectedPriceOperationName &&
        operation.persisted_query_hash === expectedPriceHash,
    )
  ) {
    throw new Error(
      `Manifest missing price operation compatible with server: ${expectedPriceOperationName} @ ${expectedPriceHash}`,
    )
  }

  if (
    !manifest.operations.some(
      (operation) =>
        operation.operation_name === expectedSearchOperationName &&
        operation.persisted_query_hash === expectedSearchHash,
    )
  ) {
    throw new Error(
      `Manifest missing search operation compatible with server: ${expectedSearchOperationName} @ ${expectedSearchHash}`,
    )
  }

  if (
    !manifest.operations.some(
      (operation) =>
        operation.operation_name === expectedPurchasedOperationName &&
        operation.persisted_query_hash === expectedPurchasedHash,
    )
  ) {
    throw new Error(
      `Manifest missing library operation compatible with server: ${expectedPurchasedOperationName} @ ${expectedPurchasedHash}`,
    )
  }

  if (
    !manifest.operations.some(
      (operation) =>
        operation.operation_name === expectedWishlistOperationName &&
        operation.persisted_query_hash === expectedWishlistHash,
    )
  ) {
    throw new Error(
      `Manifest missing wishlist operation compatible with server: ${expectedWishlistOperationName} @ ${expectedWishlistHash}`,
    )
  }

  if (manifest.endpoint.url !== expectedEndpoint) {
    throw new Error(
      `Manifest endpoint mismatch. expected=${expectedEndpoint} actual=${manifest.endpoint.url}`,
    )
  }

  for (const operation of manifest.operations) {
    if (!operation.required_headers.includes('x-apollo-operation-name')) {
      throw new Error(
        `Operation ${operation.feature} missing required header x-apollo-operation-name`,
      )
    }

    // Path allowlist is keyed by operation name, not a generic rule table. The
    // grid op accepts the two category-grid roots; the PDP op accepts
    // `data.productRetrieve` ONLY; anything else throws.
    if (operation.operation_name === expectedOperationName) {
      if (
        operation.response_path !== 'data.categoryGridRetrieve.products' &&
        operation.response_path !== 'data.categoryGridRetrieve.concepts'
      ) {
        throw new Error(
          `Operation ${operation.feature} response path incompatible: ${operation.response_path}`,
        )
      }
    } else if (
      operation.operation_name === expectedProductOperationName ||
      operation.operation_name === expectedPriceOperationName
    ) {
      if (operation.response_path !== 'data.productRetrieve') {
        throw new Error(
          `Product operation ${operation.operation_name} response path incompatible: ${operation.response_path}`,
        )
      }

      // The PDP op is addressed by a single `{ productId }` variable. Assert the
      // request-variable shape so a renamed/added variable fails the gate. Typed
      // deep-equal via canonical JSON (no `as` cast; STACK.md §8).
      if (
        !variablesSchemaEquals(operation.variables_schema, PDP_VARIABLES_SCHEMA)
      ) {
        throw new Error(
          `Product operation ${operation.operation_name} variables_schema incompatible: ${JSON.stringify(operation.variables_schema)}`,
        )
      }
    } else if (operation.operation_name === expectedSearchOperationName) {
      if (operation.response_path !== 'data.universalSearch') {
        throw new Error(
          `Search operation ${operation.operation_name} response path incompatible: ${operation.response_path}`,
        )
      }

      if (
        !variablesSchemaEquals(
          operation.variables_schema,
          SEARCH_VARIABLES_SCHEMA,
        )
      ) {
        throw new Error(
          `Search operation ${operation.operation_name} variables_schema incompatible: ${JSON.stringify(operation.variables_schema)}`,
        )
      }
    } else if (operation.operation_name === expectedPurchasedOperationName) {
      if (operation.response_path !== 'data.purchasedTitlesRetrieve.games') {
        throw new Error(
          `Library operation ${operation.operation_name} response path incompatible: ${operation.response_path}`,
        )
      }

      if (
        !variablesSchemaEquals(
          operation.variables_schema,
          PURCHASED_VARIABLES_SCHEMA,
        )
      ) {
        throw new Error(
          `Library operation ${operation.operation_name} variables_schema incompatible: ${JSON.stringify(operation.variables_schema)}`,
        )
      }
    } else if (operation.operation_name === expectedWishlistOperationName) {
      if (operation.response_path !== 'data.storeWishlistSecure') {
        throw new Error(
          `Wishlist operation ${operation.operation_name} response path incompatible: ${operation.response_path}`,
        )
      }

      if (Object.keys(operation.variables_schema).length > 0) {
        throw new Error(
          `Wishlist operation ${operation.operation_name} variables_schema incompatible: ${JSON.stringify(operation.variables_schema)}`,
        )
      }
    } else {
      throw new Error(
        `Operation ${operation.feature} has unrecognized operation_name: ${operation.operation_name}`,
      )
    }
  }

  // Source anchors: the production code of the server must still use each
  // manifest entry in the way that the checks above assume. The texts hold no
  // test code, so a test fixture cannot satisfy an anchor.
  if (!context.sonyClientText.includes('"x-apollo-operation-name"')) {
    throw new Error(
      'The Sony client does not set the expected x-apollo-operation-name header',
    )
  }

  if (!context.sonyClientText.includes('"categoryGridRetrieve"')) {
    throw new Error(
      'The Sony client grid response extraction no longer matches the expected path (categoryGridRetrieve)',
    )
  }

  // Source-side mirror of the grid check: the server must still read the PDP
  // response off `productRetrieve`. If that extraction path is renamed away,
  // the manifest's `data.productRetrieve` would be a lie; this guard fails it.
  if (!context.sonyClientText.includes('"productRetrieve"')) {
    throw new Error(
      'The Sony client PDP response extraction no longer matches the expected path (productRetrieve)',
    )
  }

  if (!context.sonyClientText.includes('"universalSearch"')) {
    throw new Error(
      'The Sony client search response extraction no longer matches the expected path (universalSearch)',
    )
  }

  if (!context.sonyClientText.includes('contract.purchased_hash')) {
    throw new Error(
      'The Sony client no longer sends the library persisted-query hash (SONY_PURCHASED_HASH, contract.purchased_hash)',
    )
  }

  if (!context.sonyClientText.includes('contract.wishlist_hash')) {
    throw new Error(
      'The Sony client no longer sends the wishlist persisted-query hash (SONY_WISHLIST_HASH, contract.wishlist_hash)',
    )
  }

  if (!context.mapperText.includes('fn concept_to_game')) {
    throw new Error('The mapper no longer maps concepts (fn concept_to_game)')
  }

  // A method call, so the declaration in the port trait does not count.
  if (!context.serviceText.includes('.concepts_by_feature(')) {
    throw new Error(
      'The games service no longer fetches feature concepts (concepts_by_feature)',
    )
  }
}
