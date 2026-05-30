import { Schema } from 'effect'

export const contractFeatureSchema = Schema.Literal(
  'new',
  'upcoming',
  'discounted',
  'details',
)

export const contractOperationSchema = Schema.Struct({
  feature: contractFeatureSchema,
  operation_name: Schema.String.pipe(Schema.minLength(1)),
  persisted_query_hash: Schema.NullOr(
    Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
  ),
  required_headers: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  variables_schema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  sample_variables: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  response_path: Schema.String.pipe(Schema.minLength(1)),
  observed_status_codes: Schema.Array(Schema.Number.pipe(Schema.int())),
})

export const sonyContractManifestSchema = Schema.Struct({
  version: Schema.Number.pipe(Schema.int(), Schema.positive()),
  metadata: Schema.Struct({
    captured_at: Schema.String.pipe(Schema.minLength(1)),
    captured_by: Schema.String.pipe(Schema.minLength(1)),
    region: Schema.Literal('fi'),
    locale: Schema.Literal('fi-fi'),
    currency: Schema.Literal('EUR'),
    target_platform: Schema.Literal('PS5'),
    playwright_profile: Schema.String.pipe(Schema.minLength(1)),
  }),
  endpoint: Schema.Struct({
    // Equivalent to the previous `z.url()`: a syntactically valid http(s) URL.
    url: Schema.String.pipe(Schema.pattern(/^https?:\/\/[^\s]+$/)),
    method: Schema.String.pipe(Schema.minLength(1)),
  }),
  operations: Schema.Array(contractOperationSchema),
})
