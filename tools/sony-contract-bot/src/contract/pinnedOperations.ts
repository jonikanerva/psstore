import { extractDefault } from '../compat/backend.js'
import type { ContractOperation } from './types.js'

// Operations the backend calls that the store page no longer fires. Capture
// cannot observe them, so refresh verifies each one with a live request.
// Each entry names the `env.ts` constants that hold its operation name and hash.
export const PINNED_OPERATIONS = [
  {
    operationNameConstant: 'SONY_PRODUCT_OPERATION_NAME',
    hashConstant: 'SONY_PRODUCT_BY_ID_HASH',
  },
] as const

// Signed-in operations. Capture and the anonymous probe cannot reach them, so
// the canonical entry carries over with the `env.ts` hash and is never verified
// live. It guards the repo-internal name and hash only, not Sony drift.
export const SIGNED_IN_PINNED_OPERATIONS = [
  {
    operationNameConstant: 'SONY_PURCHASED_OPERATION_NAME',
    hashConstant: 'SONY_PURCHASED_HASH',
  },
] as const

export interface ProbeRequest {
  readonly url: string
  readonly operationName: string
  readonly hash: string
  readonly variables: Record<string, unknown>
}

// Resolves when Sony accepts the request. Rejects with the reason otherwise.
export type Probe = (request: ProbeRequest) => Promise<void>

const unreadable = (constant: string): Error =>
  new Error(`Unable to read ${constant} from the server env defaults`)

/**
 * Add each pinned operation the capture lacks. The entry comes from the
 * canonical manifest and carries the `env.ts` hash. It is added only when the
 * probe passes. An operation that the capture holds is never probed.
 */
export const addPinnedOperations = async (
  captured: ContractOperation[],
  canonical: ContractOperation[],
  serverEnvText: string,
  probe: Probe,
  notice: (message: string) => void = (message) => {
    console.info(message)
  },
): Promise<ContractOperation[]> => {
  const url = extractDefault(serverEnvText, 'SONY_GRAPHQL_URL')
  if (!url) {
    throw unreadable('SONY_GRAPHQL_URL')
  }

  const result = [...captured]
  for (const pinned of PINNED_OPERATIONS) {
    const operationName = extractDefault(
      serverEnvText,
      pinned.operationNameConstant,
    )
    const hash = extractDefault(serverEnvText, pinned.hashConstant)
    if (!operationName) {
      throw unreadable(pinned.operationNameConstant)
    }
    if (!hash) {
      throw unreadable(pinned.hashConstant)
    }

    if (captured.some((entry) => entry.operation_name === operationName)) {
      continue
    }

    const entry = canonical.find(
      (candidate) => candidate.operation_name === operationName,
    )
    if (!entry) {
      throw new Error(
        `Pinned operation ${operationName} is not in the canonical manifest. Add it to the manifest first (docs/contracts/sony-graphql-runbook.md, Tracked operations).`,
      )
    }

    try {
      await probe({
        url,
        operationName,
        hash,
        variables: entry.sample_variables,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Live probe of pinned operation ${operationName} @ ${hash} failed: ${reason}. See docs/contracts/sony-graphql-runbook.md, Failure handling.`,
      )
    }

    result.push({ ...entry, persisted_query_hash: hash })
  }

  for (const pinned of SIGNED_IN_PINNED_OPERATIONS) {
    const operationName = extractDefault(
      serverEnvText,
      pinned.operationNameConstant,
    )
    const hash = extractDefault(serverEnvText, pinned.hashConstant)
    if (!operationName) {
      throw unreadable(pinned.operationNameConstant)
    }
    if (!hash) {
      throw unreadable(pinned.hashConstant)
    }

    const entry = canonical.find(
      (candidate) => candidate.operation_name === operationName,
    )
    if (!entry) {
      throw new Error(
        `Pinned operation ${operationName} is not in the canonical manifest. Add it to the manifest first (docs/contracts/sony-graphql-runbook.md, Signed-in library operation).`,
      )
    }

    notice(
      `Signed-in operation ${operationName} @ ${hash}: carried over, NOT verified live.`,
    )
    result.push({ ...entry, persisted_query_hash: hash })
  }

  return result
}
