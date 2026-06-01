import type { SonyContractManifest } from '../contract/types.js'

export interface CompatibilityContext {
  serverEnvText: string
  sonyClientText: string
  mapperText: string
  serviceText: string
}

// The fixed Sony-contract values are plain code constants (issue #72), no
// longer env-driven `Config.withDefault('x')` values. Anchor on the exported
// constant assignment `NAME = 'literal'` and read the quoted literal. The
// constants are at module scope with no preceding interface declaration to
// collide with.
const extractDefault = (source: string, constName: string): string | null => {
  const pattern = new RegExp(`${constName}\\s*=\\s*'([^']+)'`, 'm')
  const match = source.match(pattern)
  return match?.[1] ?? null
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

  const expectedOperationName = extractDefault(
    context.serverEnvText,
    'SONY_OPERATION_NAME',
  )
  const expectedEndpoint = extractDefault(
    context.serverEnvText,
    'SONY_GRAPHQL_URL',
  )
  // The PDP operation feeds both the product-detail page AND the
  // NEW/DISCOUNTED release-date + classification enrichment (server
  // `gamesService.ts`). Anchor compatibility on the same two server constants
  // the backend uses (`server/src/config/env.ts`).
  const expectedProductOperationName = extractDefault(
    context.serverEnvText,
    'SONY_PRODUCT_OPERATION_NAME',
  )
  const expectedProductHash = extractDefault(
    context.serverEnvText,
    'SONY_PRODUCT_BY_ID_HASH',
  )

  if (!expectedOperationName || !expectedEndpoint) {
    throw new Error(
      'Unable to read server env defaults for compatibility checks',
    )
  }

  if (!expectedProductOperationName || !expectedProductHash) {
    throw new Error(
      'Unable to read server PDP env defaults (SONY_PRODUCT_OPERATION_NAME / SONY_PRODUCT_BY_ID_HASH) for compatibility checks',
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

  // The contract gate's whole point for issue #77: require a manifest entry that
  // matches the PDP operation name AND the server's current persisted-query
  // hash. A rotated PDP hash (server `env.ts` updated, manifest stale, or vice
  // versa) fails here — closing the green-by-construction gap where the bot
  // never knew about `metGetProductById`.
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

    // Path allowlist is keyed by operation name (not a generic rule-table —
    // YAGNI; issue #64 extends the same per-operation guard style). The grid op
    // accepts the two category-grid roots; the PDP op accepts `data.productRetrieve`
    // ONLY; anything else throws.
    if (operation.operation_name === expectedOperationName) {
      if (
        operation.response_path !== 'data.categoryGridRetrieve.products' &&
        operation.response_path !== 'data.categoryGridRetrieve.concepts'
      ) {
        throw new Error(
          `Operation ${operation.feature} response path incompatible: ${operation.response_path}`,
        )
      }
    } else if (operation.operation_name === expectedProductOperationName) {
      if (operation.response_path !== 'data.productRetrieve') {
        throw new Error(
          `PDP operation ${operation.feature} response path incompatible: ${operation.response_path}`,
        )
      }

      // The PDP op is addressed by a single `{ productId }` variable. Assert the
      // request-variable shape so a renamed/added variable fails the gate. Typed
      // deep-equal via canonical JSON (no `as` cast; STACK.md §8).
      if (
        !variablesSchemaEquals(operation.variables_schema, PDP_VARIABLES_SCHEMA)
      ) {
        throw new Error(
          `PDP operation ${operation.feature} variables_schema incompatible: ${JSON.stringify(operation.variables_schema)}`,
        )
      }
    } else {
      throw new Error(
        `Operation ${operation.feature} has unrecognized operation_name: ${operation.operation_name}`,
      )
    }
  }

  if (
    !context.sonyClientText.includes(
      "'x-apollo-operation-name': strategy.operationName",
    ) &&
    !context.sonyClientText.includes(
      "'x-apollo-operation-name': env.SONY_OPERATION_NAME",
    )
  ) {
    throw new Error(
      'sonyClient does not set expected x-apollo-operation-name header',
    )
  }

  if (!context.sonyClientText.includes('categoryGridRetrieve')) {
    throw new Error(
      'sonyClient response extraction no longer matches expected path',
    )
  }

  // Source-side mirror of the grid check: the backend must still read the PDP
  // response off `productRetrieve` (server `sonyClient.ts`). If that extraction
  // path is renamed away, the manifest's `data.productRetrieve` would be a lie —
  // this guard fails it.
  if (!context.sonyClientText.includes('productRetrieve')) {
    throw new Error(
      'sonyClient PDP response extraction no longer matches expected path (productRetrieve)',
    )
  }

  if (!context.mapperText.includes('conceptToGame')) {
    throw new Error('mapper text missing conceptToGame mapping')
  }

  if (!context.serviceText.includes('fetchConceptsByFeature')) {
    throw new Error('gamesService no longer fetches feature concepts')
  }
}
