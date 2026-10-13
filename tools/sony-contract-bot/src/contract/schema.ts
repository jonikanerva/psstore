import { z } from 'zod'

export const contractFeatureSchema = z.enum([
  'new',
  'upcoming',
  'discounted',
  'details',
  'search',
  'purchased',
  'wishlist',
])

export const contractOperationSchema = z.object({
  feature: contractFeatureSchema,
  operation_name: z.string().min(1),
  persisted_query_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable(),
  required_headers: z.array(z.string().min(1)),
  variables_schema: z.record(z.string(), z.unknown()),
  sample_variables: z.record(z.string(), z.unknown()),
  response_path: z.string().min(1),
  observed_status_codes: z.array(z.int()),
})

export const sonyContractManifestSchema = z.object({
  version: z.int().gt(0),
  metadata: z.object({
    captured_at: z.string().min(1),
    captured_by: z.string().min(1),
    region: z.literal('fi'),
    locale: z.literal('fi-fi'),
    currency: z.literal('EUR'),
    target_platform: z.literal('PS5'),
    playwright_profile: z.string().min(1),
  }),
  endpoint: z.object({
    // A syntactically valid http(s) URL.
    url: z.string().regex(/^https?:\/\/[^\s]+$/),
    method: z.string().min(1),
  }),
  operations: z.array(contractOperationSchema),
})
