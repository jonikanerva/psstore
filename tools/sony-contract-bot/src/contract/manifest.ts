import type { ContractOperation, SonyContractManifest } from './types.js'

export interface ManifestMetadataInput {
  capturedBy: string
  endpointUrl: string
}

export const createManifest = (
  metadata: ManifestMetadataInput,
  operations: ContractOperation[],
): SonyContractManifest => ({
  version: 1,
  metadata: {
    captured_at: new Date().toISOString(),
    captured_by: metadata.capturedBy,
    region: 'fi',
    locale: 'fi-fi',
    currency: 'EUR',
    target_platform: 'PS5',
    playwright_profile: 'default',
  },
  endpoint: {
    url: metadata.endpointUrl,
    method: 'GET',
  },
  operations,
})
