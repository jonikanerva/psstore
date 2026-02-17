export type ContractFeature =
  | 'new'
  | 'upcoming'
  | 'discounted'
  | 'plus'
  | 'search'
  | 'details'

export interface ContractOperation {
  feature: ContractFeature
  operation_name: string
  persisted_query_hash: string | null
  required_headers: string[]
  variables_schema: Record<string, unknown>
  sample_variables: Record<string, unknown>
  response_path: string
  observed_status_codes: number[]
}

export interface SonyContractManifest {
  version: number
  metadata: {
    captured_at: string
    captured_by: string
    region: 'fi'
    locale: 'fi-fi'
    currency: 'EUR'
    target_platform: 'PS5'
    playwright_profile: string
  }
  endpoint: {
    url: string
    method: string
  }
  operations: ContractOperation[]
}

export interface CaptureRecord {
  method: string
  url: string
  headers: Record<string, string>
  status: number
  responseJson: unknown
}
