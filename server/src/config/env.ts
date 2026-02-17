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
    .default('257713466fc3264850aa473409a29088e3a4115e6e69e9fb3e061c8dd5b9f5c6'),
  SONY_CATEGORY_ID: z.string().default('d0446d4b-dc9a-4f1e-86ec-651f099c9b29'),
  SONY_DEALS_CATEGORY_ID: z.string().default('3f772501-f6f8-49b7-abac-874a88ca4897'),
  SONY_OPERATION_NAME: z.string().default('categoryGridRetrieve'),
  SONY_PRODUCT_OPERATION_NAME: z.string().default('metGetProductById'),
  SONY_PRODUCT_BY_ID_HASH: z
    .string()
    .default('a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a'),
  SONY_LOCALE: z.string().default('fi-fi'),
  SONY_RETRY_COUNT: z.coerce.number().int().min(0).max(3).default(1),
  SONY_TIMEOUT_MS: z.coerce.number().int().min(100).default(6000),
  CACHE_TTL_MS: z.coerce.number().int().min(100).default(30000),
})

export type Env = z.infer<typeof envSchema>
export const env = envSchema.parse(process.env)
