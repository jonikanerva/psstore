import type { Game } from '@psstore/shared'
import { env } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import { sonyStrategies, type SonyFeature, type StrategyContext } from './queryStrategies.js'
import type { CategoryGridRetrieveResponse, Concept, ProductRetrieveResponse } from './types.js'

const productOperationName = env.SONY_PRODUCT_OPERATION_NAME
const productOperationHash = env.SONY_PRODUCT_BY_ID_HASH
const SEARCH_TILE_RE = /<li[^>]*data-qa="search#productTile\d+"[\s\S]*?<\/li>/g
const TELEMETRY_RE = /data-telemetry-meta="([^"]+)"/
const IMAGE_RE = /data-qa="search#productTile\d+#game-art#image#preview"[^>]*src="([^"]+)"/

interface SearchTelemetry {
  id: string
  index: number
  name: string
  price: string
}

const decodeHtml = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')

const gameFromSearchTile = (tileHtml: string): Game | null => {
  const telemetryMatch = tileHtml.match(TELEMETRY_RE)
  if (!telemetryMatch?.[1]) {
    return null
  }

  const telemetryJson = decodeHtml(telemetryMatch[1])
  let telemetry: SearchTelemetry

  try {
    telemetry = JSON.parse(telemetryJson) as SearchTelemetry
  } catch {
    return null
  }

  const imageMatch = tileHtml.match(IMAGE_RE)
  const imageUrl = imageMatch?.[1] ? decodeHtml(imageMatch[1]).split('?')[0] ?? '' : ''

  return {
    id: telemetry.id,
    name: telemetry.name,
    date: '',
    url: imageUrl,
    price: telemetry.price === 'Ei saatavilla' ? '' : telemetry.price,
    discountDate: '',
    screenshots: imageUrl ? [imageUrl] : [],
    videos: [],
    genres: [],
    description: '',
    studio: '',
    preOrder: false,
  }
}

export const extractSearchGamesFromHtml = (html: string, limit = 48): Game[] => {
  const games: Game[] = []
  for (const match of html.matchAll(SEARCH_TILE_RE)) {
    const tileHtml = match[0]
    const game = gameFromSearchTile(tileHtml)
    if (!game) {
      continue
    }
    games.push(game)
    if (games.length >= limit) {
      break
    }
  }
  return games
}

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

export const fetchSearchGames = async (query: string, limit = 48): Promise<Game[]> => {
  const response = await fetchWithRetry(
    `https://store.playstation.com/fi-fi/search/${encodeURIComponent(query)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'text/html',
      },
    },
    Math.min(env.SONY_TIMEOUT_MS, 5000),
    0,
  )

  const html = await response.text()
  return extractSearchGamesFromHtml(html, limit)
}
