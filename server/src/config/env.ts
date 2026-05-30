import { Config, Context, Effect, Layer } from 'effect'

// Application configuration, read from the environment via Effect `Config`
// (replaces the previous zod-parsed `env` object). String defaults are written
// as `Config.withDefault('literal')` so the contract bot can still text-extract
// the canonical operation name and endpoint (tools/sony-contract-bot
// compat/backend.ts).

export interface AppConfig {
  readonly NODE_ENV: 'development' | 'test' | 'production'
  readonly PORT: number
  readonly SONY_GRAPHQL_URL: string
  readonly SONY_CATEGORY_GRID_HASH: string
  readonly SONY_CATEGORY_ID: string
  readonly SONY_DEALS_CATEGORY_ID: string
  readonly SONY_OPERATION_NAME: string
  readonly SONY_PRODUCT_OPERATION_NAME: string
  readonly SONY_PRODUCT_BY_ID_HASH: string
  readonly SONY_LOCALE: string
  readonly SONY_RETRY_COUNT: number
  readonly SONY_TIMEOUT_MS: number
  readonly CACHE_TTL_MS: number
}

const appConfig: Config.Config<AppConfig> = Config.all({
  NODE_ENV: Config.literal(
    'development',
    'test',
    'production',
  )('NODE_ENV').pipe(Config.withDefault('development')),
  PORT: Config.integer('PORT').pipe(Config.withDefault(3000)),
  SONY_GRAPHQL_URL: Config.string('SONY_GRAPHQL_URL').pipe(
    Config.withDefault('https://web.np.playstation.com/api/graphql/v1/op'),
  ),
  SONY_CATEGORY_GRID_HASH: Config.string('SONY_CATEGORY_GRID_HASH').pipe(
    Config.withDefault(
      '257713466fc3264850aa473409a29088e3a4115e6e69e9fb3e061c8dd5b9f5c6',
    ),
  ),
  SONY_CATEGORY_ID: Config.string('SONY_CATEGORY_ID').pipe(
    Config.withDefault('d0446d4b-dc9a-4f1e-86ec-651f099c9b29'),
  ),
  SONY_DEALS_CATEGORY_ID: Config.string('SONY_DEALS_CATEGORY_ID').pipe(
    Config.withDefault('3f772501-f6f8-49b7-abac-874a88ca4897'),
  ),
  SONY_OPERATION_NAME: Config.string('SONY_OPERATION_NAME').pipe(
    Config.withDefault('categoryGridRetrieve'),
  ),
  SONY_PRODUCT_OPERATION_NAME: Config.string(
    'SONY_PRODUCT_OPERATION_NAME',
  ).pipe(Config.withDefault('metGetProductById')),
  SONY_PRODUCT_BY_ID_HASH: Config.string('SONY_PRODUCT_BY_ID_HASH').pipe(
    Config.withDefault(
      'a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a',
    ),
  ),
  SONY_LOCALE: Config.string('SONY_LOCALE').pipe(Config.withDefault('fi-fi')),
  SONY_RETRY_COUNT: Config.integer('SONY_RETRY_COUNT').pipe(
    Config.withDefault(1),
  ),
  SONY_TIMEOUT_MS: Config.integer('SONY_TIMEOUT_MS').pipe(
    Config.withDefault(6000),
  ),
  CACHE_TTL_MS: Config.integer('CACHE_TTL_MS').pipe(Config.withDefault(30000)),
})

export class Env extends Context.Tag('Env')<Env, AppConfig>() {}

export const EnvLive: Layer.Layer<Env> = Layer.effect(
  Env,
  Effect.orDie(appConfig),
)
