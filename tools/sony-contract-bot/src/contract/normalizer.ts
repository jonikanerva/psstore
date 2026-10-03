import { SIGNED_IN_FEATURES } from './constants.js'
import { operationIdentity } from './operationIdentity.js'
import type { ContractOperation } from './types.js'

const normalizeRecord = (operation: ContractOperation): ContractOperation => ({
  ...operation,
  required_headers: [...new Set(operation.required_headers)].sort(),
  observed_status_codes: [...new Set(operation.observed_status_codes)].sort(
    (a, b) => a - b,
  ),
})

export const normalizeOperations = (
  operations: ContractOperation[],
): ContractOperation[] => {
  const map = new Map<string, ContractOperation>()

  for (const operation of operations.map(normalizeRecord)) {
    const key = operationIdentity(operation)
    if (!map.has(key)) {
      map.set(key, operation)
    }
  }

  return [...map.values()].sort((a, b) => {
    return operationIdentity(a).localeCompare(operationIdentity(b))
  })
}

// Capture cannot see signed-in operations, so the canonical entries (with
// their owner-recorded observed status) pass through unchanged.
export const withSignedInOperations = (
  captured: ContractOperation[],
  canonical: ContractOperation[],
): ContractOperation[] => [
  ...captured,
  ...canonical.filter((operation) =>
    SIGNED_IN_FEATURES.includes(operation.feature),
  ),
]
