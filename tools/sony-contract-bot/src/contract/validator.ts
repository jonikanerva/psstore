import { CORE_FEATURES } from './constants.js'
import { operationIdentity } from './operationIdentity.js'
import { sonyContractManifestSchema } from './schema.js'
import type { SonyContractManifest } from './types.js'

export const validateManifest = (manifest: SonyContractManifest): void => {
  // Parsing throws a ZodError on a malformed manifest. The CLI surfaces it
  // as a validation failure.
  sonyContractManifestSchema.parse(manifest)

  for (const feature of CORE_FEATURES) {
    if (
      !manifest.operations.some((operation) => operation.feature === feature)
    ) {
      throw new Error(`Missing required feature mapping: ${feature}`)
    }
  }

  const seen = new Set<string>()
  for (const operation of manifest.operations) {
    const identity = operationIdentity(operation)
    if (seen.has(identity)) {
      throw new Error(`Duplicate operation identity detected: ${identity}`)
    }

    seen.add(identity)
  }
}
