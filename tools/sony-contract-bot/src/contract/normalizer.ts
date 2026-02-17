import type { ContractOperation } from './types.js'

const normalizeRecord = (operation: ContractOperation): ContractOperation => ({
  ...operation,
  required_headers: [...new Set(operation.required_headers)].sort(),
  observed_status_codes: [...new Set(operation.observed_status_codes)].sort((a, b) => a - b),
})

const dedupeKey = (operation: ContractOperation): string =>
  JSON.stringify([
    operation.feature,
    operation.operation_name,
    operation.persisted_query_hash,
    operation.response_path,
    operation.required_headers,
    operation.variables_schema,
  ])

export const normalizeOperations = (operations: ContractOperation[]): ContractOperation[] => {
  const map = new Map<string, ContractOperation>()

  for (const operation of operations.map(normalizeRecord)) {
    const key = dedupeKey(operation)
    if (!map.has(key)) {
      map.set(key, operation)
    }
  }

  return [...map.values()].sort((a, b) => {
    const left = `${a.feature}:${a.operation_name}:${a.persisted_query_hash ?? ''}`
    const right = `${b.feature}:${b.operation_name}:${b.persisted_query_hash ?? ''}`
    return left.localeCompare(right)
  })
}
