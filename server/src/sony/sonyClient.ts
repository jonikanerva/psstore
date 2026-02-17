import { env } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import { sonyStrategies, type SonyFeature, type StrategyContext } from './queryStrategies.js'
import type { CategoryGridRetrieveResponse, Concept, ProductRetrieveResponse } from './types.js'

const productOperationName = env.SONY_PRODUCT_OPERATION_NAME
const productOperationHash = env.SONY_PRODUCT_BY_ID_HASH
const localeOverride = env.SONY_LOCALE.replace(
  /^([a-z]{2})-([a-z]{2})$/i,
  (_match, language, region) => `${language.toLowerCase()}-${region.toUpperCase()}`,
)

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
  const concepts = json.data?.categoryGridRetrieve?.concepts ?? []

  console.info(
    JSON.stringify({
      source: 'sony',
      feature,
      operation: strategy.operationName,
      count: concepts.length,
      fallbackKey: strategy.fallbackKey,
    }),
  )

  return concepts
}

export const fetchConceptsByFeature = async (
  feature: Exclude<SonyFeature, 'search'>,
  size = 300,
  offset = 0,
): Promise<Concept[]> => requestConcepts(feature, { size, offset })

export const fetchSearchConcepts = async (query: string, size = 120): Promise<Concept[]> =>
  requestConcepts('search', { size, offset: 0, query })

export const extractReleaseDateFromProductResponse = (json: ProductRetrieveResponse): string | undefined => {
  const releaseDate = json.data?.productRetrieve?.releaseDate
  return typeof releaseDate === 'string' && releaseDate.length > 0 ? releaseDate : undefined
}

export const fetchProductReleaseDate = async (productId: string): Promise<string | undefined> => {
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
        'content-type': 'application/json',
        'x-apollo-operation-name': productOperationName,
        'x-psn-store-locale-override': localeOverride,
      },
    },
    env.SONY_TIMEOUT_MS,
    env.SONY_RETRY_COUNT,
  )

  const json = (await response.json()) as ProductRetrieveResponse
  return extractReleaseDateFromProductResponse(json)
}

