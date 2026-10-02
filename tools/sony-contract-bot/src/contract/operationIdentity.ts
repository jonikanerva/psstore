import type { ContractOperation } from './types.js'

export const operationIdentity = (
  operation: Pick<
    ContractOperation,
    'feature' | 'operation_name' | 'persisted_query_hash'
  >,
): string =>
  `${operation.feature}:${operation.operation_name}:${operation.persisted_query_hash ?? ''}`
