import { z } from 'zod'

export const contractFeatureSchema = z.enum([
  'new',
  'upcoming',
  'discounted',
  'plus',
  'search',
  'details',
])

export const contractOperationSchema = z.object({
  feature: contractFeatureSchema,
  operation_name: z.string().min(1),
  persisted_query_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable(),
  required_headers: z.array(z.string().min(1)),
  variables_schema: z.record(z.unknown()),
  sample_variables: z.record(z.unknown()),
  response_path: z.string().min(1),
  observed_status_codes: z.array(z.number().int()),
})

export const sonyContractManifestSchema = z.object({
  version: z.number().int().positive(),
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
    url: z.string().url(),
    method: z.string().min(1),
  }),
  operations: z.array(contractOperationSchema),
})
