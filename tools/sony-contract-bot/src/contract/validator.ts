import { Schema } from 'effect'
import { CORE_FEATURES } from './constants.js'
import { operationIdentity } from './operationIdentity.js'
import { sonyContractManifestSchema } from './schema.js'
import type { SonyContractManifest } from './types.js'

const decodeManifest = Schema.decodeUnknownSync(sonyContractManifestSchema)

export const validateManifest = (manifest: SonyContractManifest): void => {
  // Decode throws a SchemaError on a malformed manifest. The CLI surfaces it
  // as a validation failure.
  decodeManifest(manifest)

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
