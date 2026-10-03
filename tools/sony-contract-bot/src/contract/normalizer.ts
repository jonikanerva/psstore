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
