import { Schema } from 'effect'
import { extractDefault } from '../compat/backend.js'
import type { SonyContractManifest } from '../contract/types.js'
import { readJsonFile, readTextFile, writeJsonFile } from '../io/files.js'
import { paths } from '../io/paths.js'

const OPERATION_LABEL = 'getPurchasedGameList'
const REQUEST_TIMEOUT_MS = 10_000
// Same cookie-safe set and length bounds as the server sign-in (STACK.md §14).
const NPSSO_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/

export type ProbeTag =
  | 'npsso-invalid'
  | 'env-unreadable'
  | 'manifest-entry-missing'
  | 'authorize-rejected'
  | 'authorize-unexpected'
  | 'token-unusable'
  | 'http-status'
  | 'query-rotated'
  | 'shape-drift'
  | 'unexpected'

// Messages are fixed text. A failure never carries a credential, a header, a
// redirect target or a response body.
export class ProbeFailure extends Error {
  readonly tag: ProbeTag
  readonly status: number | null

  constructor(tag: ProbeTag, status: number | null = null) {
    super(`probe failed: ${tag}`)
    this.name = 'ProbeFailure'
    this.tag = tag
    this.status = status
  }
}

export interface ProbeConfig {
  readonly graphqlUrl: string
  readonly authBaseUrl: string
  readonly clientId: string
  readonly redirectUri: string
  readonly scope: string
  readonly basicHeader: string
  readonly operationName: string
  readonly hash: string
  readonly locale: string
}

const CONFIG_CONSTANTS = {
  graphqlUrl: 'SONY_GRAPHQL_URL',
  authBaseUrl: 'SONY_AUTH_BASE_URL',
  clientId: 'SONY_AUTH_CLIENT_ID',
  redirectUri: 'SONY_AUTH_REDIRECT_URI',
  scope: 'SONY_AUTH_SCOPE',
  basicHeader: 'SONY_AUTH_BASIC_HEADER',
  operationName: 'SONY_PURCHASED_OPERATION_NAME',
  hash: 'SONY_PURCHASED_HASH',
  locale: 'SONY_LOCALE',
} as const satisfies Record<keyof ProbeConfig, string>

export const readProbeConfig = (serverEnvText: string): ProbeConfig => {
  const read = (constant: string): string => {
    const value = extractDefault(serverEnvText, constant)
    if (value === null) {
      throw new ProbeFailure('env-unreadable')
    }
    return value
  }
  return {
    graphqlUrl: read(CONFIG_CONSTANTS.graphqlUrl),
    authBaseUrl: read(CONFIG_CONSTANTS.authBaseUrl),
    clientId: read(CONFIG_CONSTANTS.clientId),
    redirectUri: read(CONFIG_CONSTANTS.redirectUri),
    scope: read(CONFIG_CONSTANTS.scope),
    basicHeader: read(CONFIG_CONSTANTS.basicHeader),
    operationName: read(CONFIG_CONSTANTS.operationName),
    hash: read(CONFIG_CONSTANTS.hash),
    locale: read(CONFIG_CONSTANTS.locale),
  }
}

// Returns the NPSSO, or throws a fixed error that never echoes the value.
export const parseNpsso = (value: string | undefined): string => {
  if (value === undefined || !NPSSO_PATTERN.test(value)) {
    throw new ProbeFailure('npsso-invalid')
  }
  return value
}

const localeOverride = (locale: string): string =>
  locale.replace(
    /^([a-z]{2})-([a-z]{2})$/i,
    (_match: string, language: string, region: string) =>
      `${language.toLowerCase()}-${region.toUpperCase()}`,
  )

const extractAccessCode = (
  location: string | null,
  redirectUri: string,
): string | null => {
  if (location === null || !location.startsWith(redirectUri)) {
    return null
  }
  const queryStart = location.indexOf('?')
  if (queryStart === -1) {
    return null
  }
  const code = new URLSearchParams(location.slice(queryStart + 1)).get('code')
  return code === null || code === '' ? null : code
}

const hasAccessToken = (
  body: unknown,
): body is { readonly access_token: string } =>
  typeof body === 'object' &&
  body !== null &&
  'access_token' in body &&
  typeof body.access_token === 'string' &&
  body.access_token !== ''

// One-shot copy of the NPSSO exchange in server/src/sony/sonyClient.ts, which
// owns the flow. Keep both in step. Returns the access token only.
export const exchangeNpsso = async (
  npsso: string,
  config: ProbeConfig,
  fetchFn: typeof fetch,
): Promise<string> => {
  const query = new URLSearchParams({
    access_type: 'offline',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope,
  }).toString()
  const authorize = await fetchFn(`${config.authBaseUrl}/authorize?${query}`, {
    method: 'GET',
    headers: { Cookie: `npsso=${npsso}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (authorize.status !== 302) {
    throw new ProbeFailure('authorize-unexpected')
  }
  const code = extractAccessCode(
    authorize.headers.get('location'),
    config.redirectUri,
  )
  if (code === null) {
    throw new ProbeFailure('authorize-rejected')
  }

  const tokenResponse = await fetchFn(`${config.authBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: config.basicHeader,
    },
    body: new URLSearchParams({
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      token_format: 'jwt',
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body: unknown = await tokenResponse.json().catch(() => null)
  if (!hasAccessToken(body)) {
    throw new ProbeFailure('token-unusable')
  }
  return body.access_token
}

const libraryEnvelopeSchema = Schema.Struct({
  data: Schema.Struct({
    purchasedTitlesRetrieve: Schema.Struct({
      games: Schema.Array(Schema.Unknown),
    }),
  }),
})

const isLibraryEnvelope = Schema.is(libraryEnvelopeSchema)

// Requests one library item. Resolves with the HTTP status (always 200) only
// when the response holds a valid `data.purchasedTitlesRetrieve.games` array.
export const probePurchased = async (
  accessToken: string,
  config: ProbeConfig,
  fetchFn: typeof fetch,
): Promise<number> => {
  const query = new URLSearchParams({
    operationName: config.operationName,
    variables: JSON.stringify({
      isActive: true,
      platform: ['ps5'],
      size: 1,
      start: 0,
      sortBy: 'ACTIVE_DATE',
      sortDirection: 'desc',
    }),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: config.hash },
    }),
  }).toString()
  const response = await fetchFn(`${config.graphqlUrl}?${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-apollo-operation-name': config.operationName,
      'x-psn-store-locale-override': localeOverride(config.locale),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status !== 200) {
    throw new ProbeFailure('http-status', response.status)
  }
  const body: unknown = await response.json().catch(() => null)
  if (JSON.stringify(body).toLowerCase().includes('persistedquerynotfound')) {
    throw new ProbeFailure('query-rotated', response.status)
  }
  if (!isLibraryEnvelope(body)) {
    throw new ProbeFailure('shape-drift', response.status)
  }
  return response.status
}

// Sets the hash and the observed status of the purchased entry. Leaves the
// capture metadata untouched. Throws when the manifest has no such entry.
export const recordObservedStatus = (
  manifest: SonyContractManifest,
  hash: string,
  status: number,
): SonyContractManifest => {
  if (!manifest.operations.some((entry) => entry.feature === 'purchased')) {
    throw new ProbeFailure('manifest-entry-missing')
  }
  return {
    ...manifest,
    operations: manifest.operations.map((entry) =>
      entry.feature === 'purchased'
        ? {
            ...entry,
            persisted_query_hash: hash,
            observed_status_codes: [status],
          }
        : entry,
    ),
  }
}

export interface ProbeRunOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetchFn?: typeof fetch
  readonly manifestPath?: string
  readonly envFilePath?: string
}

// Owner-run check. Prints the operation name, the status code and PASS or
// FAIL, nothing else. Writes the manifest on PASS only.
export const runProbePurchased = async (
  options: ProbeRunOptions = {},
): Promise<void> => {
  const {
    env = process.env,
    fetchFn = fetch,
    manifestPath = paths.canonicalManifest,
    envFilePath = paths.envFile,
  } = options
  try {
    const npsso = parseNpsso(env['SONY_NPSSO'])
    const config = readProbeConfig(await readTextFile(envFilePath))
    const manifest = await readJsonFile<SonyContractManifest>(manifestPath)
    if (!manifest.operations.some((entry) => entry.feature === 'purchased')) {
      throw new ProbeFailure('manifest-entry-missing')
    }

    const accessToken = await exchangeNpsso(npsso, config, fetchFn)
    const status = await probePurchased(accessToken, config, fetchFn)
    await writeJsonFile(
      manifestPath,
      recordObservedStatus(manifest, config.hash, status),
    )
    console.info(`${OPERATION_LABEL} ${String(status)} PASS`)
  } catch (error) {
    const tag = error instanceof ProbeFailure ? error.tag : 'unexpected'
    const status = error instanceof ProbeFailure ? error.status : null
    console.error(
      `${OPERATION_LABEL} ${status === null ? '-' : String(status)} FAIL (${tag})`,
    )
    process.exitCode = 1
  }
}
