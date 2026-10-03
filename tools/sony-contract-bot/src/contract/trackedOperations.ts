import type { ContractOperation } from './types.js'

// The only operations the server calls. Any other operation Sony fires on a
// captured page is noise and never reaches the manifest.
export const TRACKED_OPERATIONS: readonly string[] = [
  'categoryGridRetrieve',
  'metGetProductById',
  'conceptRetrieveForCtasWithPrice',
  'productRetrieveForCtasWithPrice',
  'getSearchResults',
  'getPurchasedGameList',
]

export const filterTrackedOperations = (
  operations: ContractOperation[],
): ContractOperation[] =>
  operations.filter((operation) =>
    TRACKED_OPERATIONS.includes(operation.operation_name),
  )
