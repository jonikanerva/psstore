import type { Probe } from './pinnedOperations.js'

const PROBE_TIMEOUT_MS = 10_000

const hasRotationError = (body: unknown): boolean =>
  JSON.stringify(body).toLowerCase().includes('persistedquerynotfound')

const hasProductNode = (body: unknown): boolean => {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return false
  }
  const { data } = body
  return (
    typeof data === 'object' &&
    data !== null &&
    'productRetrieve' in data &&
    typeof data.productRetrieve === 'object' &&
    data.productRetrieve !== null
  )
}

// One plain anonymous GET with the same headers the server sends.
export const liveProbe: Probe = async (request) => {
  const query = new URLSearchParams({
    operationName: request.operationName,
    variables: JSON.stringify(request.variables),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: request.hash },
    }),
  }).toString()

  const response = await fetch(`${request.url}?${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-apollo-operation-name': request.operationName,
      'x-psn-store-locale-override': 'en-FI',
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (response.status !== 200) {
    throw new Error(`HTTP ${String(response.status)}`)
  }

  const body: unknown = await response.json()
  if (hasRotationError(body)) {
    throw new Error('PersistedQueryNotFound (hash rotated)')
  }
  if (!hasProductNode(body)) {
    throw new Error('response has no data.productRetrieve')
  }
}
