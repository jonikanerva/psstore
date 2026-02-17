import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SONY_GRAPHQL_URL: z
    .string()
    .url()
    .default('https://web.np.playstation.com/api/graphql/v1/op'),
  SONY_CATEGORY_GRID_HASH: z
    .string()
    .default('757de84ff8efb4aeaa78f4faf51bd610bce94a3fcb248ba158916cb88c5cdb7c'),
  SONY_CATEGORY_ID: z.string().default('12a53448-199e-459b-956d-074feeed2d7d'),
  SONY_OPERATION_NAME: z.string().default('categoryGridRetrieve'),
  SONY_LOCALE: z.string().default('en-us'),
  SONY_RETRY_COUNT: z.coerce.number().int().min(0).max(3).default(1),
  SONY_TIMEOUT_MS: z.coerce.number().int().min(100).default(6000),
  CACHE_TTL_MS: z.coerce.number().int().min(100).default(30000),
})

export type Env = z.infer<typeof envSchema>
export const env = envSchema.parse(process.env)
