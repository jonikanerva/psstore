import { CORE_FEATURES } from './constants.js'
import { sonyContractManifestSchema } from './schema.js'
import type { SonyContractManifest } from './types.js'

const opIdentity = (operation: SonyContractManifest['operations'][number]): string =>
  `${operation.feature}:${operation.operation_name}:${operation.persisted_query_hash ?? ''}`

export const validateManifest = (manifest: SonyContractManifest): void => {
  sonyContractManifestSchema.parse(manifest)

  for (const feature of CORE_FEATURES) {
    if (!manifest.operations.some((operation) => operation.feature === feature)) {
      throw new Error(`Missing required feature mapping: ${feature}`)
    }
  }

  const seen = new Set<string>()
  for (const operation of manifest.operations) {
    const identity = opIdentity(operation)
    if (seen.has(identity)) {
      throw new Error(`Duplicate operation identity detected: ${identity}`)
    }

    seen.add(identity)
  }
}
