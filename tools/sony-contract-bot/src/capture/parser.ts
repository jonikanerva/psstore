import { HEADER_ALLOWLIST } from '../contract/constants.js'
import type { CaptureRecord, ContractFeature, ContractOperation } from '../contract/types.js'

const jsonType = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return []
    }

    return [jsonType(value[0])]
  }

  if (value === null) {
    return 'null'
  }

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return typeof value
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      )
      return Object.fromEntries(entries.map(([key, val]) => [key, jsonType(val)]))
    }
    default:
      return 'unknown'
  }
}

const getResponsePath = (responseJson: unknown): string => {
  const data = (responseJson as { data?: Record<string, unknown> })?.data
  if (!data || typeof data !== 'object') {
    return 'data'
  }

  const rootKey = Object.keys(data)[0]
  if (!rootKey) {
    return 'data'
  }

  const root = data[rootKey] as { products?: unknown[] } | undefined
  if (root && Array.isArray(root.products)) {
    return `data.${rootKey}.products`
  }

  return `data.${rootKey}`
}

const parseVariables = (url: URL): Record<string, unknown> => {
  const raw = url.searchParams.get('variables')
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return parsed
  } catch {
    return {}
  }
}

const parseHash = (url: URL): string | null => {
  const raw = url.searchParams.get('extensions')
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as {
      persistedQuery?: {
        sha256Hash?: string
      }
    }
    return parsed.persistedQuery?.sha256Hash ?? null
  } catch {
    return null
  }
}

export const parseCaptureRecordToOperation = (
  record: CaptureRecord,
  feature: ContractFeature,
): ContractOperation => {
  const url = new URL(record.url)
  const operationName =
    url.searchParams.get('operationName') ??
    record.headers['x-apollo-operation-name'] ??
    record.headers['X-Apollo-Operation-Name'] ??
    'unknownOperation'

  const variables = parseVariables(url)
  const variablesSchema = jsonType(variables) as Record<string, unknown>

  const requiredHeaders = HEADER_ALLOWLIST.filter(
    (header) => record.headers[header] || record.headers[header.toLowerCase()],
  )
  const normalizedRequiredHeaders =
    requiredHeaders.length > 0 || operationName !== 'unknownOperation'
      ? ['x-apollo-operation-name']
      : requiredHeaders

  return {
    feature,
    operation_name: operationName,
    persisted_query_hash: parseHash(url),
    required_headers: normalizedRequiredHeaders,
    variables_schema: variablesSchema,
    sample_variables: variables,
    response_path: getResponsePath(record.responseJson),
    observed_status_codes: [record.status],
  }
}
