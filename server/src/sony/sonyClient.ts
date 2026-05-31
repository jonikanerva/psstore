import { Context, Effect, Layer } from 'effect'
import {
  SONY_GRAPHQL_URL,
  SONY_LOCALE,
  SONY_PRODUCT_BY_ID_HASH,
  SONY_PRODUCT_OPERATION_NAME,
  SONY_RETRY_COUNT,
  SONY_TIMEOUT_MS,
} from '../config/env.js'
import {
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import { fetchWithRetry, RateLimitedError } from '../lib/http.js'
import {
  extractCategoryGridNode,
  parseCategoryGrid,
} from './categoryGridSchema.js'
import { detectPersistedQueryRotation } from './graphqlErrors.js'
import { parseProductRetrieve } from './productDetailSchema.js'
import {
  buildStrategies,
  type SonyFeature,
  type StrategyContext,
} from './queryStrategies.js'
import type {
  CategoryGridProduct,
  Concept,
  ProductRetrieveResponse,
} from './types.js'

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

export const extractReleaseDateFromProductResponse = (
  json: ProductRetrieveResponse,
): string | undefined => {
  const releaseDate = json.data?.productRetrieve?.releaseDate
  return typeof releaseDate === 'string' && releaseDate.length > 0
    ? releaseDate
    : undefined
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
  descriptions: ReadonlyArray<{
    type?: string | undefined
    value?: string | undefined
  }>,
  type: 'LONG' | 'SHORT',
): string => {
  const match = descriptions.find((entry) => entry.type === type)
  const value = match?.value
  return typeof value === 'string' ? value : ''
}

export const extractProductDetail = (
  json: ProductRetrieveResponse,
): ProductDetailResult => {
  // Validate at the trust boundary. A malformed or missing node degrades to
  // empty description / genres instead of throwing.
  const product = parseProductRetrieve(json.data?.productRetrieve)

  const releaseDate =
    typeof product?.releaseDate === 'string' && product.releaseDate.length > 0
      ? product.releaseDate
      : undefined

  const descriptions = product?.descriptions ?? []
  const description =
    descriptionByType(descriptions, 'LONG') ||
    descriptionByType(descriptions, 'SHORT')

  const genres = (product?.combinedLocalizedGenres ?? [])
    .map((genre) => genre.value)
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )

  const publisherName =
    typeof product?.publisherName === 'string' &&
    product.publisherName.length > 0
      ? product.publisherName
      : undefined

  const storeDisplayClassification =
    typeof product?.storeDisplayClassification === 'string' &&
    product.storeDisplayClassification.length > 0
      ? product.storeDisplayClassification
      : undefined

  return {
    releaseDate,
    genres,
    description,
    publisherName,
    storeDisplayClassification,
  }
}

/**
 * The outcome of decoding a category-grid response, distinguishing the two
 * empty-list cases the drift policy requires (devils-advocate cut 3):
 *  - `drift`: the `data.categoryGridRetrieve` node was absent or undecodable —
 *    a corrupt grid. The caller degrades to `[]` AND logs a warning so the
 *    operator sees an honest signal.
 *  - `ok`: the node was present and decoded (its concepts/products may be
 *    legitimately empty) — the caller returns the selection silently.
 */
export type CategoryGridOutcome =
  | { readonly kind: 'drift' }
  | { readonly kind: 'ok'; readonly concepts: readonly Concept[] }

/**
 * Pure category-grid extraction (exported for unit tests; parallels
 * `extractProductDetail`). Decodes the envelope and the inner node defensively,
 * then applies the concepts-first selection (a concept list wins; otherwise the
 * product list mapped to concepts) — unchanged from the previous inline logic.
 */
export const extractCategoryGrid = (json: unknown): CategoryGridOutcome => {
  const node = extractCategoryGridNode(json)
  if (node === undefined || node === null) {
    return { kind: 'drift' }
  }

  const grid = parseCategoryGrid(node)
  if (grid === null) {
    return { kind: 'drift' }
  }

  const concepts = grid.concepts ?? []
  const products = (grid.products ?? []).map(productToConcept)
  return { kind: 'ok', concepts: concepts.length > 0 ? concepts : products }
}

// ---- SonyClient service (the network boundary) -----------------------------

const requestConceptsRaw = async (
  feature: SonyFeature,
  context: StrategyContext,
): Promise<unknown> => {
  const strategy = buildStrategies()[feature]
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
    `${SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': strategy.operationName,
        'x-psn-store-locale-override': localeOverride(SONY_LOCALE),
      },
    },
    SONY_TIMEOUT_MS,
    SONY_RETRY_COUNT,
  )

  // Untrusted until decoded — returned as `unknown`; rotation detection and the
  // Schema decode run in the Effect layer below.
  return response.json()
}

const requestProductDetailRaw = async (
  productId: string,
): Promise<ProductRetrieveResponse> => {
  const query = new URLSearchParams({
    operationName: SONY_PRODUCT_OPERATION_NAME,
    variables: JSON.stringify({ productId }),
    extensions: JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: SONY_PRODUCT_BY_ID_HASH,
      },
    }),
  }).toString()

  const response = await fetchWithRetry(
    `${SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': SONY_PRODUCT_OPERATION_NAME,
        'x-psn-store-locale-override': localeOverride(SONY_LOCALE),
      },
    },
    SONY_TIMEOUT_MS,
    SONY_RETRY_COUNT,
  )

  // The product boundary is decoded downstream by `parseProductRetrieve` inside
  // `extractProductDetail`; this cast only shapes the envelope it reads and is
  // left in place per issue #62 scope (the category-grid cast is the one this
  // change removes). Rotation detection runs on the raw body in the Effect layer.
  return (await response.json()) as ProductRetrieveResponse
}

// Map a transport-layer rejection onto the typed error channel. The rate-limit
// sentinel (structured `RateLimitedError` from lib/http.ts) is pattern-matched
// by instance — never by message string — and becomes UpstreamRateLimited;
// everything else is a generic UpstreamUnavailable.
const mapTransportError = (
  error: unknown,
): UpstreamRateLimited | UpstreamUnavailable => {
  if (error instanceof RateLimitedError) {
    const retryAfterSeconds =
      error.retryAfterMs === null
        ? undefined
        : Math.ceil(error.retryAfterMs / 1000)
    return new UpstreamRateLimited({
      message: 'Sony upstream rate limited the request (HTTP 429)',
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    })
  }
  return new UpstreamUnavailable({
    message:
      error instanceof Error ? error.message : 'Sony upstream unavailable',
  })
}

export interface SonyClientApi {
  readonly fetchConceptsByFeature: (
    feature: SonyFeature,
    size?: number,
    offset?: number,
  ) => Effect.Effect<
    Concept[],
    UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited
  >
  readonly fetchProductDetail: (
    productId: string,
  ) => Effect.Effect<
    ProductDetailResult,
    UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited
  >
}

export class SonyClient extends Context.Tag('SonyClient')<
  SonyClient,
  SonyClientApi
>() {}

export const SonyClientLive: Layer.Layer<SonyClient> = Layer.succeed(
  SonyClient,
  SonyClient.of({
    fetchConceptsByFeature: (feature, size = 300, offset = 0) =>
      Effect.tryPromise({
        try: () => requestConceptsRaw(feature, { size, offset }),
        catch: mapTransportError,
      }).pipe(
        // A persisted-query rotation (HTTP 200 + Apollo errors[]) is a distinct,
        // operator-actionable failure → 502 UpstreamQueryRotated, not a silent
        // empty grid (issue #62 / Sony runbook).
        Effect.flatMap((json) =>
          detectPersistedQueryRotation(json)
            ? Effect.fail(
                new UpstreamQueryRotated({
                  message:
                    'Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh',
                  operationName: buildStrategies()[feature].operationName,
                }),
              )
            : Effect.succeed(json),
        ),
        Effect.flatMap((json) => {
          const outcome = extractCategoryGrid(json)
          if (outcome.kind === 'drift') {
            // Corrupt-or-absent grid: degrade to [] for the user (VISION
            // continuity over blankness) but emit an honest operator signal so a
            // schema drift is never mistaken for a legitimately empty grid
            // (STACK §9 structured log — feature/operation context only, no PII).
            return Effect.logWarning('sony category grid drift', {
              event: 'sony.categoryGrid.drift',
              feature,
              operationName: buildStrategies()[feature].operationName,
            }).pipe(Effect.as<Concept[]>([]))
          }
          return Effect.succeed<Concept[]>([...outcome.concepts])
        }),
      ),
    fetchProductDetail: (productId) =>
      Effect.tryPromise({
        try: () => requestProductDetailRaw(productId),
        catch: mapTransportError,
      }).pipe(
        Effect.flatMap((json) =>
          detectPersistedQueryRotation(json)
            ? Effect.fail(
                new UpstreamQueryRotated({
                  message:
                    'Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh',
                  operationName: SONY_PRODUCT_OPERATION_NAME,
                }),
              )
            : Effect.succeed(extractProductDetail(json)),
        ),
      ),
  }),
)
