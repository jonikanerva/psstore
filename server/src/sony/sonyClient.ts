import { Context, Effect, Layer } from 'effect'
import { Env } from '../config/env.js'
import type { AppConfig } from '../config/env.js'
import { UpstreamUnavailable } from '../errors/errors.js'
import { fetchWithRetry } from '../lib/http.js'
import { parseProductRetrieve } from './productDetailSchema.js'
import { buildStrategies, type SonyFeature, type StrategyContext } from './queryStrategies.js'
import type { CategoryGridProduct, CategoryGridRetrieveResponse, Concept, ProductRetrieveResponse } from './types.js'

const localeOverride = (locale: string): string =>
  locale.replace(
    /^([a-z]{2})-([a-z]{2})$/i,
    (_match: string, language: string, region: string) =>
      `${language.toLowerCase()}-${region.toUpperCase()}`,
  )

const productToConcept = (product: CategoryGridProduct): Concept => ({
  id: product.id,
  name: product.name,
  media: product.media,
  price: product.price,
  products: [{ id: product.id }],
})

// ---- Pure response extraction (exported for unit tests) --------------------

export const extractReleaseDateFromProductResponse = (json: ProductRetrieveResponse): string | undefined => {
  const releaseDate = json.data?.productRetrieve?.releaseDate
  return typeof releaseDate === 'string' && releaseDate.length > 0 ? releaseDate : undefined
}

export interface ProductDetailResult {
  releaseDate?: string | undefined
  genres: string[]
  description: string
  publisherName?: string | undefined
  storeDisplayClassification?: string | undefined
}

/**
 * Sony's `productRetrieve.descriptions[]` carries several typed entries. The
 * PDP "game info" panel uses the LONG body, falling back to the SHORT tagline.
 * COMPATIBILITY_NOTICE and LEGAL entries are never user-facing copy and are
 * excluded.
 */
const descriptionByType = (
  descriptions: ReadonlyArray<{ type?: string | undefined; value?: string | undefined }>,
  type: 'LONG' | 'SHORT',
): string => {
  const match = descriptions.find((entry) => entry.type === type)
  const value = match?.value
  return typeof value === 'string' ? value : ''
}

export const extractProductDetail = (json: ProductRetrieveResponse): ProductDetailResult => {
  // Validate at the trust boundary. A malformed or missing node degrades to
  // empty description / genres instead of throwing.
  const product = parseProductRetrieve(json.data?.productRetrieve)

  const releaseDate = typeof product?.releaseDate === 'string' && product.releaseDate.length > 0
    ? product.releaseDate
    : undefined

  const descriptions = product?.descriptions ?? []
  const description = descriptionByType(descriptions, 'LONG') || descriptionByType(descriptions, 'SHORT')

  const genres = (product?.combinedLocalizedGenres ?? [])
    .map((genre) => genre.value)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const publisherName = typeof product?.publisherName === 'string' && product.publisherName.length > 0
    ? product.publisherName
    : undefined

  const storeDisplayClassification = typeof product?.storeDisplayClassification === 'string' && product.storeDisplayClassification.length > 0
    ? product.storeDisplayClassification
    : undefined

  return { releaseDate, genres, description, publisherName, storeDisplayClassification }
}

// ---- SonyClient service (the network boundary) -----------------------------

const requestConceptsPromise = async (
  config: AppConfig,
  feature: SonyFeature,
  context: StrategyContext,
): Promise<Concept[]> => {
  const strategy = buildStrategies(config)[feature]
  const variables = strategy.buildVariables(context)

  const extensions = {
    persistedQuery: { version: 1, sha256Hash: strategy.persistedQueryHash },
  }

  const query = new URLSearchParams({
    operationName: strategy.operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify(extensions),
  }).toString()

  const response = await fetchWithRetry(
    `${config.SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': strategy.operationName,
        'x-psn-store-locale-override': localeOverride(config.SONY_LOCALE),
      },
    },
    config.SONY_TIMEOUT_MS,
    config.SONY_RETRY_COUNT,
  )

  const json = (await response.json()) as CategoryGridRetrieveResponse
  const grid = json.data?.categoryGridRetrieve
  const concepts = grid?.concepts ?? []
  const products = (grid?.products ?? []).map(productToConcept)
  return concepts.length > 0 ? concepts : products
}

const requestProductDetailPromise = async (
  config: AppConfig,
  productId: string,
): Promise<ProductDetailResult> => {
  const query = new URLSearchParams({
    operationName: config.SONY_PRODUCT_OPERATION_NAME,
    variables: JSON.stringify({ productId }),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: config.SONY_PRODUCT_BY_ID_HASH },
    }),
  }).toString()

  const response = await fetchWithRetry(
    `${config.SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': config.SONY_PRODUCT_OPERATION_NAME,
        'x-psn-store-locale-override': localeOverride(config.SONY_LOCALE),
      },
    },
    config.SONY_TIMEOUT_MS,
    config.SONY_RETRY_COUNT,
  )

  const json = (await response.json()) as ProductRetrieveResponse
  return extractProductDetail(json)
}

const upstream = (error: unknown): UpstreamUnavailable =>
  new UpstreamUnavailable({
    message: error instanceof Error ? error.message : 'Sony upstream unavailable',
  })

export interface SonyClientApi {
  readonly fetchConceptsByFeature: (
    feature: SonyFeature,
    size?: number,
    offset?: number,
  ) => Effect.Effect<Concept[], UpstreamUnavailable>
  readonly fetchProductDetail: (
    productId: string,
  ) => Effect.Effect<ProductDetailResult, UpstreamUnavailable>
}

export class SonyClient extends Context.Tag('SonyClient')<SonyClient, SonyClientApi>() {}

export const SonyClientLive: Layer.Layer<SonyClient, never, Env> = Layer.effect(
  SonyClient,
  Effect.gen(function* () {
    const config = yield* Env
    return SonyClient.of({
      fetchConceptsByFeature: (feature, size = 300, offset = 0) =>
        Effect.tryPromise({
          try: () => requestConceptsPromise(config, feature, { size, offset }),
          catch: upstream,
        }),
      fetchProductDetail: (productId) =>
        Effect.tryPromise({
          try: () => requestProductDetailPromise(config, productId),
          catch: upstream,
        }),
    })
  }),
)
