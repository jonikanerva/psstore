import type { PlusOffer } from '@psstore/shared'
import { Context, Effect, Layer, Redacted } from 'effect'
import {
  SONY_AUTH_BASE_URL,
  SONY_AUTH_BASIC_HEADER,
  SONY_AUTH_CLIENT_ID,
  SONY_AUTH_DEADLINE_MS,
  SONY_AUTH_REDIRECT_URI,
  SONY_AUTH_SCOPE,
  SONY_GRAPHQL_URL,
  SONY_LOCALE,
  SONY_PLUS_MONTHLY_CATEGORY,
  SONY_PLUS_MONTHLY_URL,
  SONY_PRODUCT_BY_ID_HASH,
  SONY_PRODUCT_OPERATION_NAME,
  SONY_PRODUCT_PRICE_HASH,
  SONY_PRODUCT_PRICE_OPERATION_NAME,
  SONY_PURCHASED_DEADLINE_MS,
  SONY_PURCHASED_HASH,
  SONY_PURCHASED_MAX_PAGES,
  SONY_PURCHASED_OPERATION_NAME,
  SONY_PURCHASED_PAGE_SIZE,
  SONY_RETRY_COUNT,
  SONY_SEARCH_HASH,
  SONY_SEARCH_OPERATION_NAME,
  SONY_TIMEOUT_MS,
} from '../config/env.js'
import {
  SessionRejected,
  UpstreamQueryRotated,
  UpstreamRateLimited,
  UpstreamUnavailable,
} from '../errors/errors.js'
import {
  fetchWithRetry,
  HttpStatusError,
  RateLimitedError,
} from '../lib/http.js'
import { narrowSearchEntries, type SearchCandidate } from '../domain/listing.js'
import {
  extractCategoryGridNode,
  parseCategoryGrid,
} from './categoryGridSchema.js'
import { detectPersistedQueryRotation } from './graphqlErrors.js'
import { parseProductRetrieve } from './productDetailSchema.js'
import { parsePlusMonthly, type PlusMonthlyEntry } from './plusMonthlySchema.js'
import { parsePlusOffer } from './productPriceSchema.js'
import { parseSearchResponse } from './searchSchema.js'
import {
  dedupePurchased,
  parsePurchasedPage,
  type PurchasedEntry,
} from './purchasedSchema.js'
import { extractAccessCode, parseTokenResponse } from './sessionSchema.js'
import {
  buildStrategies,
  type SonyFeature,
  type StrategyContext,
} from './queryStrategies.js'
import { productToConcept } from './mapper.js'
import type { Concept, ProductRetrieveResponse } from './types.js'

export const localeOverride = (locale: string): string =>
  locale.replace(
    /^([a-z]{2})-([a-z]{2})$/i,
    (_match: string, language: string, region: string) =>
      `${language.toLowerCase()}-${region.toUpperCase()}`,
  )

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
  platforms?: string[] | undefined
}

/**
 * Sony's `productRetrieve.descriptions[]` carries several typed entries. The
 * PDP "game info" panel uses the LONG body, falling back to the SHORT tagline.
 * COMPATIBILITY_NOTICE and LEGAL entries are never user-facing copy and are
 * excluded.
 */
const descriptionByType = (
  descriptions: ReadonlyArray<{
    type?: string | null | undefined
    value?: string | null | undefined
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

  const platforms = (product?.platforms ?? []).filter(
    (value): value is string => typeof value === 'string',
  )

  return {
    releaseDate,
    genres,
    description,
    publisherName,
    storeDisplayClassification,
    platforms,
  }
}

/**
 * The outcome of decoding a category-grid response. The drift policy
 * distinguishes the empty-list cases at two granularities:
 *  - `drift`: the `data.categoryGridRetrieve` node was absent or its outer shape
 *    was unintelligible — a corrupt grid. The caller degrades to `[]` AND logs a
 *    warning so the operator sees an honest signal.
 *  - `ok`: the node was present and its outer shape decoded (concepts/products
 *    may be legitimately empty). `dropped` counts individual elements that
 *    failed per-element decode and were skipped; a non-zero `dropped` is an
 *    element-drift signal the caller logs WITHOUT emptying the list — one odd
 *    item never empties the whole grid.
 */
export type CategoryGridOutcome =
  | { readonly kind: 'drift' }
  | {
      readonly kind: 'ok'
      readonly concepts: readonly Concept[]
      readonly dropped: number
    }

/**
 * Pure category-grid extraction (exported for unit tests; parallels
 * `extractProductDetail`). Decodes the envelope and the inner node defensively
 * and per-element, then applies the concepts-first selection (a concept list
 * wins; otherwise the product list mapped to concepts).
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

  const products = grid.products.map(productToConcept)
  const concepts = grid.concepts.length > 0 ? grid.concepts : products
  return { kind: 'ok', concepts, dropped: grid.dropped }
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
  // `extractProductDetail`; this cast only shapes the envelope it reads.
  // Rotation detection runs on the raw body in the Effect layer.
  return (await response.json()) as ProductRetrieveResponse
}

const requestProductPriceRaw = async (productId: string): Promise<unknown> => {
  const query = new URLSearchParams({
    operationName: SONY_PRODUCT_PRICE_OPERATION_NAME,
    variables: JSON.stringify({ productId }),
    extensions: JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: SONY_PRODUCT_PRICE_HASH,
      },
    }),
  }).toString()

  const response = await fetchWithRetry(
    `${SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': SONY_PRODUCT_PRICE_OPERATION_NAME,
        'x-psn-store-locale-override': localeOverride(SONY_LOCALE),
      },
    },
    SONY_TIMEOUT_MS,
    SONY_RETRY_COUNT,
  )

  return response.json()
}

const requestSearchRaw = async (
  term: string,
  offset: number,
  size: number,
): Promise<unknown> => {
  const query = new URLSearchParams({
    operationName: SONY_SEARCH_OPERATION_NAME,
    variables: JSON.stringify({
      countryCode: 'FI',
      languageCode: 'en',
      nextCursor: '',
      pageOffset: offset,
      pageSize: size,
      searchTerm: term,
    }),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: SONY_SEARCH_HASH },
    }),
  }).toString()

  const response = await fetchWithRetry(
    `${SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-apollo-operation-name': SONY_SEARCH_OPERATION_NAME,
        'x-psn-store-locale-override': localeOverride(SONY_LOCALE),
      },
    },
    SONY_TIMEOUT_MS,
    SONY_RETRY_COUNT,
  )

  return response.json()
}

const requestPlusMonthlyRaw = async (): Promise<unknown> => {
  const query = new URLSearchParams({
    locale: SONY_LOCALE,
    categoryList: SONY_PLUS_MONTHLY_CATEGORY,
  }).toString()

  const response = await fetchWithRetry(
    `${SONY_PLUS_MONTHLY_URL}?${query}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    SONY_TIMEOUT_MS,
    SONY_RETRY_COUNT,
  )

  return response.json()
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

// One search page read from `data.universalSearch`, after scope narrowing.
// `isLast` comes from Sony's page info; `rawCount` is the page size before
// narrowing.
export interface SearchPage {
  readonly candidates: readonly SearchCandidate[]
  readonly isLast: boolean
  readonly rawCount: number
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
  readonly fetchProductPrice: (
    productId: string,
  ) => Effect.Effect<
    PlusOffer | null,
    UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited
  >
  readonly fetchSearchPage: (
    term: string,
    offset: number,
    size: number,
  ) => Effect.Effect<
    SearchPage,
    UpstreamUnavailable | UpstreamQueryRotated | UpstreamRateLimited
  >
  readonly fetchPlusMonthly: () => Effect.Effect<
    readonly PlusMonthlyEntry[],
    UpstreamUnavailable | UpstreamRateLimited
  >
}

export class SonyClient extends Context.Service<SonyClient, SonyClientApi>()(
  'SonyClient',
) {}

export const SonyClientLive: Layer.Layer<SonyClient> = Layer.succeed(
  SonyClient,
  SonyClient.of({
    fetchConceptsByFeature: (feature, size = 300, offset = 0) =>
      Effect.tryPromise({
        try: () => requestConceptsRaw(feature, { size, offset }),
        catch: mapTransportError,
      }).pipe(
        // A persisted-query rotation (HTTP 200 + Apollo errors[]) is a distinct,
        // operator-actionable failure → 502 UpstreamQueryRotated, not an empty
        // grid (docs/contracts/sony-graphql-runbook.md).
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
            // Corrupt-or-absent node: degrade to [] for the user (VISION
            // continuity over blankness) but emit an honest operator signal so a
            // schema drift is never mistaken for a legitimately empty grid
            // (STACK §9 structured log — feature/operation context only, no PII).
            return Effect.logWarning('sony category grid drift', {
              event: 'sony.categoryGrid.drift',
              feature,
              operationName: buildStrategies()[feature].operationName,
            }).pipe(Effect.as<Concept[]>([]))
          }
          const concepts: Concept[] = [...outcome.concepts]
          if (outcome.dropped > 0) {
            // Some elements failed per-element decode and were skipped; the good
            // items are still returned (one odd item never empties the grid).
            // A distinct, lower-severity signal from a whole-node drift.
            return Effect.logWarning('sony category grid element drift', {
              event: 'sony.categoryGrid.elementDrift',
              feature,
              operationName: buildStrategies()[feature].operationName,
              dropped: outcome.dropped,
              kept: concepts.length,
            }).pipe(Effect.as(concepts))
          }
          return Effect.succeed(concepts)
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
    fetchSearchPage: (term, offset, size) =>
      Effect.tryPromise({
        try: () => requestSearchRaw(term, offset, size),
        catch: mapTransportError,
      }).pipe(
        Effect.flatMap((json) =>
          detectPersistedQueryRotation(json)
            ? Effect.fail(
                new UpstreamQueryRotated({
                  message:
                    'Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh',
                  operationName: SONY_SEARCH_OPERATION_NAME,
                }),
              )
            : Effect.succeed(json),
        ),
        Effect.flatMap((json) => {
          const outcome = parseSearchResponse(json)
          if (outcome.kind === 'drift') {
            // Failing keeps a broken search distinct from "no results". The log
            // never carries the term.
            return Effect.logWarning('sony search drift', {
              event: 'sony.search.drift',
            }).pipe(
              Effect.andThen(
                Effect.fail(
                  new UpstreamUnavailable({
                    message: 'Sony search response has an unexpected shape',
                  }),
                ),
              ),
            )
          }
          const page: SearchPage = {
            candidates: narrowSearchEntries(outcome.entries),
            isLast: outcome.isLast,
            rawCount: outcome.entries.length + outcome.dropped,
          }
          return outcome.dropped > 0
            ? Effect.logWarning('sony search element drift', {
                event: 'sony.search.elementDrift',
                dropped: outcome.dropped,
                kept: outcome.entries.length,
              }).pipe(Effect.as(page))
            : Effect.succeed(page)
        }),
      ),
    fetchPlusMonthly: () =>
      Effect.tryPromise({
        try: requestPlusMonthlyRaw,
        catch: mapTransportError,
      }).pipe(
        Effect.flatMap((json) => {
          const outcome = parsePlusMonthly(json)
          if (outcome.kind === 'drift') {
            return Effect.logWarning('plus monthly list drift', {
              event: 'sony.plusMonthly.drift',
            }).pipe(
              Effect.andThen(
                Effect.fail(
                  new UpstreamUnavailable({
                    message: 'PS Plus monthly list has an unexpected shape',
                  }),
                ),
              ),
            )
          }
          const log =
            outcome.entries.length === 0
              ? Effect.logWarning('plus monthly list has no PS5 games', {
                  event: 'sony.plusMonthly.empty',
                })
              : outcome.dropped > 0
                ? Effect.logWarning('plus monthly list element drift', {
                    event: 'sony.plusMonthly.elementDrift',
                    dropped: outcome.dropped,
                    kept: outcome.entries.length,
                  })
                : Effect.logDebug('plus monthly list decoded', {
                    outOfScope: outcome.outOfScope,
                    kept: outcome.entries.length,
                  })
          return log.pipe(Effect.as(outcome.entries))
        }),
      ),
    fetchProductPrice: (productId) =>
      Effect.tryPromise({
        try: () => requestProductPriceRaw(productId),
        catch: mapTransportError,
      }).pipe(
        Effect.flatMap((json) =>
          detectPersistedQueryRotation(json)
            ? Effect.fail(
                new UpstreamQueryRotated({
                  message:
                    'Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh',
                  operationName: SONY_PRODUCT_PRICE_OPERATION_NAME,
                }),
              )
            : Effect.succeed(parsePlusOffer(json)),
        ),
      ),
  }),
)

// ---- Signed-in account client ----------------------------------------------
// Kept apart from SonyClient: only the account service can reach credentials.
// Sign-in and library calls never retry (retries = 0) and use fixed error
// messages, so no header, redirect target or token reaches a log or a response.

export type AccountError =
  SessionRejected | UpstreamUnavailable | UpstreamRateLimited

export type LibraryError = AccountError | UpstreamQueryRotated

export interface SonyAccountClientApi {
  // Exchanges the NPSSO for a short-lived access token. Resolves to the token
  // only; any refresh or id token Sony returns is dropped.
  readonly exchangeNpsso: (
    npsso: Redacted.Redacted,
  ) => Effect.Effect<Redacted.Redacted, AccountError>
  // The whole PS5 library in Sony's order, de-duplicated by product id.
  readonly fetchPurchasedGames: (
    accessToken: Redacted.Redacted,
  ) => Effect.Effect<readonly PurchasedEntry[], LibraryError>
}

export class SonyAccountClient extends Context.Service<
  SonyAccountClient,
  SonyAccountClientApi
>()('SonyAccountClient') {}

// `rejectingStatuses`: HTTP statuses that prove Sony refused the credential.
const mapAccountTransportError =
  (rejectingStatuses: readonly number[]) =>
  (error: unknown): AccountError => {
    if (error instanceof RateLimitedError) {
      return new UpstreamRateLimited({
        message: 'Sony sign-in rate limited the request (HTTP 429)',
        ...(error.retryAfterMs === null
          ? {}
          : { retryAfterSeconds: Math.ceil(error.retryAfterMs / 1000) }),
      })
    }
    if (
      error instanceof HttpStatusError &&
      rejectingStatuses.includes(error.status)
    ) {
      return new SessionRejected({ message: 'Sony rejected the sign-in' })
    }
    return new UpstreamUnavailable({ message: 'Sony sign-in unavailable' })
  }

type AuthorizeOutcome =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'unexpected' }

const requestAccessCode = async (
  npsso: Redacted.Redacted,
): Promise<AuthorizeOutcome> => {
  const query = new URLSearchParams({
    access_type: 'offline',
    client_id: SONY_AUTH_CLIENT_ID,
    redirect_uri: SONY_AUTH_REDIRECT_URI,
    response_type: 'code',
    scope: SONY_AUTH_SCOPE,
  }).toString()
  const response = await fetchWithRetry(
    `${SONY_AUTH_BASE_URL}/authorize?${query}`,
    {
      method: 'GET',
      // Only the sign-in cookie is sent. Set-Cookie answers are never read.
      headers: { Cookie: `npsso=${Redacted.value(npsso)}` },
      redirect: 'manual',
    },
    SONY_TIMEOUT_MS,
    0,
  )
  if (response.status !== 302) {
    return { kind: 'unexpected' }
  }
  const code = extractAccessCode(response.headers.get('location'))
  return code === null ? { kind: 'rejected' } : { kind: 'code', code }
}

const requestAccessToken = async (code: string): Promise<unknown> => {
  const response = await fetchWithRetry(
    `${SONY_AUTH_BASE_URL}/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: SONY_AUTH_BASIC_HEADER,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: SONY_AUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
        token_format: 'jwt',
      }).toString(),
    },
    SONY_TIMEOUT_MS,
    0,
  )
  return response.json()
}

const requestPurchasedPage = async (
  accessToken: Redacted.Redacted,
  start: number,
): Promise<unknown> => {
  const query = new URLSearchParams({
    operationName: SONY_PURCHASED_OPERATION_NAME,
    variables: JSON.stringify({
      isActive: true,
      platform: ['ps5'],
      size: SONY_PURCHASED_PAGE_SIZE,
      start,
      sortBy: 'ACTIVE_DATE',
      sortDirection: 'desc',
    }),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: SONY_PURCHASED_HASH },
    }),
  }).toString()
  const response = await fetchWithRetry(
    `${SONY_GRAPHQL_URL}?${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${Redacted.value(accessToken)}`,
        'x-apollo-operation-name': SONY_PURCHASED_OPERATION_NAME,
        'x-psn-store-locale-override': localeOverride(SONY_LOCALE),
      },
    },
    SONY_TIMEOUT_MS,
    0,
  )
  return response.json()
}

const exchangeNpsso = (
  npsso: Redacted.Redacted,
): Effect.Effect<Redacted.Redacted, AccountError> =>
  Effect.gen(function* () {
    const authorize = yield* Effect.tryPromise({
      try: () => requestAccessCode(npsso),
      catch: mapAccountTransportError([]),
    })
    if (authorize.kind === 'rejected') {
      return yield* new SessionRejected({
        message: 'Sony rejected the sign-in',
      })
    }
    if (authorize.kind === 'unexpected') {
      return yield* new UpstreamUnavailable({
        message: 'Sony sign-in answered unexpectedly',
      })
    }
    const json = yield* Effect.tryPromise({
      try: () => requestAccessToken(authorize.code),
      catch: mapAccountTransportError([401, 403]),
    })
    const session = parseTokenResponse(json)
    if (session === null) {
      return yield* new UpstreamUnavailable({
        message: 'Sony sign-in answered unexpectedly',
      })
    }
    return session.accessToken
  }).pipe(
    Effect.timeoutOrElse({
      duration: SONY_AUTH_DEADLINE_MS,
      orElse: () =>
        Effect.fail(
          new UpstreamUnavailable({ message: 'Sony sign-in timed out' }),
        ),
    }),
  )

const fetchPurchasedGames = (
  accessToken: Redacted.Redacted,
): Effect.Effect<readonly PurchasedEntry[], LibraryError> =>
  Effect.gen(function* () {
    const collected: PurchasedEntry[] = []
    for (let page = 0; page < SONY_PURCHASED_MAX_PAGES; page += 1) {
      const json = yield* Effect.tryPromise({
        try: () =>
          requestPurchasedPage(accessToken, page * SONY_PURCHASED_PAGE_SIZE),
        catch: mapAccountTransportError([401, 403]),
      })
      if (detectPersistedQueryRotation(json)) {
        return yield* new UpstreamQueryRotated({
          message:
            'Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh',
          operationName: SONY_PURCHASED_OPERATION_NAME,
        })
      }
      const outcome = parsePurchasedPage(json)
      if (outcome.kind === 'drift') {
        yield* Effect.logWarning('sony purchased list drift', {
          event: 'sony.purchased.drift',
        })
        return yield* new UpstreamUnavailable({
          message: 'Sony library list has an unexpected shape',
        })
      }
      if (outcome.dropped > 0) {
        yield* Effect.logWarning('sony purchased list element drift', {
          event: 'sony.purchased.elementDrift',
          dropped: outcome.dropped,
          kept: outcome.entries.length,
        })
      }
      collected.push(...outcome.entries)
      if (outcome.rawCount < SONY_PURCHASED_PAGE_SIZE) {
        return dedupePurchased(collected)
      }
    }
    // The last allowed page was still full: more games may exist. A truncated
    // library is never shown as complete.
    return yield* new UpstreamUnavailable({
      message: 'Sony library list exceeds the supported size',
    })
  }).pipe(
    Effect.timeoutOrElse({
      duration: SONY_PURCHASED_DEADLINE_MS,
      orElse: () =>
        Effect.fail(
          new UpstreamUnavailable({ message: 'Sony library list timed out' }),
        ),
    }),
  )

export const SonyAccountClientLive: Layer.Layer<SonyAccountClient> =
  Layer.succeed(
    SonyAccountClient,
    SonyAccountClient.of({ exchangeNpsso, fetchPurchasedGames }),
  )
