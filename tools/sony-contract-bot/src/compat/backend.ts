import type { SonyContractManifest } from '../contract/types.js'

export interface CompatibilityContext {
  serverEnvText: string
  sonyClientText: string
  mapperText: string
  serviceText: string
}

const extractDefault = (source: string, envName: string): string | null => {
  const pattern = new RegExp(`${envName}:[\\s\\S]*?default\\('([^']+)'\\)`, 'm')
  const match = source.match(pattern)
  return match?.[1] ?? null
}

export const validateBackendCompatibility = (
  manifest: SonyContractManifest,
  context: CompatibilityContext,
): void => {
  if (
    manifest.metadata.region !== 'fi' ||
    manifest.metadata.locale !== 'fi-fi' ||
    manifest.metadata.currency !== 'EUR' ||
    manifest.metadata.target_platform !== 'PS5'
  ) {
    throw new Error('Manifest metadata must be fixed to fi / fi-fi / EUR / PS5')
  }

  const expectedOperationName = extractDefault(context.serverEnvText, 'SONY_OPERATION_NAME')
  const expectedEndpoint = extractDefault(context.serverEnvText, 'SONY_GRAPHQL_URL')

  if (!expectedOperationName || !expectedEndpoint) {
    throw new Error('Unable to read server env defaults for compatibility checks')
  }

  if (!manifest.operations.some((operation) => operation.operation_name === expectedOperationName)) {
    throw new Error(`Manifest missing operation_name compatible with server: ${expectedOperationName}`)
  }

  if (manifest.endpoint.url !== expectedEndpoint) {
    throw new Error(
      `Manifest endpoint mismatch. expected=${expectedEndpoint} actual=${manifest.endpoint.url}`,
    )
  }

  for (const operation of manifest.operations) {
    if (!operation.required_headers.includes('x-apollo-operation-name')) {
      throw new Error(`Operation ${operation.feature} missing required header x-apollo-operation-name`)
    }

    if (
      operation.response_path !== 'data.categoryGridRetrieve.products' &&
      operation.response_path !== 'data.categoryGridRetrieve.concepts'
    ) {
      throw new Error(
        `Operation ${operation.feature} response path incompatible: ${operation.response_path}`,
      )
    }
  }

  if (
    !context.sonyClientText.includes("'x-apollo-operation-name': strategy.operationName") &&
    !context.sonyClientText.includes("'x-apollo-operation-name': env.SONY_OPERATION_NAME")
  ) {
    throw new Error('sonyClient does not set expected x-apollo-operation-name header')
  }

  if (!context.sonyClientText.includes('categoryGridRetrieve')) {
    throw new Error('sonyClient response extraction no longer matches expected path')
  }

  if (!context.mapperText.includes('conceptToGame')) {
    throw new Error('mapper text missing conceptToGame mapping')
  }

  if (!context.serviceText.includes('fetchConceptsByFeature')) {
    throw new Error('gamesService no longer fetches feature concepts')
  }

  if (!context.serviceText.includes('fetchSearchConcepts')) {
    throw new Error('gamesService no longer fetches search concepts')
  }
}
