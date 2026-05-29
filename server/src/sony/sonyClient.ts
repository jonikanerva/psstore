import { env } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import { parseProductRetrieve } from './productDetailSchema.js'
import { sonyStrategies, type SonyFeature, type StrategyContext } from './queryStrategies.js'
import type { CategoryGridProduct, CategoryGridRetrieveResponse, Concept, ProductRetrieveResponse } from './types.js'

const productOperationName = env.SONY_PRODUCT_OPERATION_NAME
const productOperationHash = env.SONY_PRODUCT_BY_ID_HASH
const localeOverride = env.SONY_LOCALE.replace(
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

const requestConcepts = async (
  feature: SonyFeature,
  context: StrategyContext,
): Promise<Concept[]> => {
  const strategy = sonyStrategies[feature]
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
    `${env.SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': strategy.operationName,
        'x-psn-store-locale-override': localeOverride,
      },
    },
    env.SONY_TIMEOUT_MS,
    env.SONY_RETRY_COUNT,
  )

  const json = (await response.json()) as CategoryGridRetrieveResponse
  const grid = json.data?.categoryGridRetrieve
  const concepts = grid?.concepts ?? []
  const products = (grid?.products ?? []).map(productToConcept)
  const result = concepts.length > 0 ? concepts : products

  console.info(
    JSON.stringify({
      source: 'sony',
      feature,
      operation: strategy.operationName,
      count: result.length,
      fallbackKey: strategy.fallbackKey,
    }),
  )

  return result
}

export const fetchConceptsByFeature = async (
  feature: SonyFeature,
  size = 300,
  offset = 0,
): Promise<Concept[]> => requestConcepts(feature, { size, offset })

export const extractReleaseDateFromProductResponse = (json: ProductRetrieveResponse): string | undefined => {
  const releaseDate = json.data?.productRetrieve?.releaseDate
  return typeof releaseDate === 'string' && releaseDate.length > 0 ? releaseDate : undefined
}

export interface ProductDetailResult {
  releaseDate?: string | undefined
  genres: string[]
  description: string
  publisherName?: string | undefined
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
  // Validate at the trust boundary (STACK.md §7). A malformed or missing node
  // degrades to empty description / genres instead of throwing (AGENTS.md §5.1).
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

  return { releaseDate, genres, description, publisherName }
}

export const fetchProductDetail = async (productId: string): Promise<ProductDetailResult> => {
  const query = new URLSearchParams({
    operationName: productOperationName,
    variables: JSON.stringify({ productId }),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: productOperationHash },
    }),
  }).toString()

  const response = await fetchWithRetry(
    `${env.SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': productOperationName,
        'x-psn-store-locale-override': localeOverride,
      },
    },
    env.SONY_TIMEOUT_MS,
    env.SONY_RETRY_COUNT,
  )

  const json = (await response.json()) as ProductRetrieveResponse
  return extractProductDetail(json)
}

export const fetchProductReleaseDate = async (productId: string): Promise<string | undefined> => {
  const detail = await fetchProductDetail(productId)
  return detail.releaseDate
}
