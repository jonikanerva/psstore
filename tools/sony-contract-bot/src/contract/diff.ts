import type { ContractOperation, SonyContractManifest } from './types.js'

export interface ManifestDiff {
  hasDrift: boolean
  added: ContractOperation[]
  removed: ContractOperation[]
  changed: Array<{
    from: ContractOperation
    to: ContractOperation
  }>
}

const identity = (operation: ContractOperation): string => `${operation.feature}:${operation.operation_name}`

const equals = (left: ContractOperation, right: ContractOperation): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const diffManifests = (base: SonyContractManifest, next: SonyContractManifest): ManifestDiff => {
  const baseMap = new Map(base.operations.map((operation) => [identity(operation), operation]))
  const nextMap = new Map(next.operations.map((operation) => [identity(operation), operation]))

  const added: ContractOperation[] = []
  const removed: ContractOperation[] = []
  const changed: Array<{ from: ContractOperation; to: ContractOperation }> = []

  for (const [key, nextOperation] of nextMap.entries()) {
    const baseOperation = baseMap.get(key)
    if (!baseOperation) {
      added.push(nextOperation)
      continue
    }

    if (!equals(baseOperation, nextOperation)) {
      changed.push({ from: baseOperation, to: nextOperation })
    }
  }

  for (const [key, baseOperation] of baseMap.entries()) {
    if (!nextMap.has(key)) {
      removed.push(baseOperation)
    }
  }

  return {
    hasDrift: added.length > 0 || removed.length > 0 || changed.length > 0,
    added,
    removed,
    changed,
  }
}
