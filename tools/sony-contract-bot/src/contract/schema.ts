import { Schema } from 'effect'

export const contractFeatureSchema = Schema.Literals([
  'new',
  'upcoming',
  'discounted',
  'details',
  'search',
])

export const contractOperationSchema = Schema.Struct({
  feature: contractFeatureSchema,
  operation_name: Schema.String.check(Schema.isMinLength(1)),
  persisted_query_hash: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/i)),
  ),
  required_headers: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  variables_schema: Schema.Record(Schema.String, Schema.Unknown),
  sample_variables: Schema.Record(Schema.String, Schema.Unknown),
  response_path: Schema.String.check(Schema.isMinLength(1)),
  observed_status_codes: Schema.Array(Schema.Number.check(Schema.isInt())),
})

export const sonyContractManifestSchema = Schema.Struct({
  version: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  metadata: Schema.Struct({
    captured_at: Schema.String.check(Schema.isMinLength(1)),
    captured_by: Schema.String.check(Schema.isMinLength(1)),
    region: Schema.Literal('fi'),
    locale: Schema.Literal('fi-fi'),
    currency: Schema.Literal('EUR'),
    target_platform: Schema.Literal('PS5'),
    playwright_profile: Schema.String.check(Schema.isMinLength(1)),
  }),
  endpoint: Schema.Struct({
    // A syntactically valid http(s) URL.
    url: Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/)),
    method: Schema.String.check(Schema.isMinLength(1)),
  }),
  operations: Schema.Array(contractOperationSchema),
})
