import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import {
  readSonyConstants,
  sonyConstant,
  type SonyConstants,
} from '../contract/sonyConstants.js'
import type { SonyContractManifest } from '../contract/types.js'
import { readJsonFile, writeFormattedJsonFile } from '../io/files.js'
import { paths } from '../io/paths.js'

const REQUEST_TIMEOUT_MS = 10_000
// Same cookie-safe set and length bounds as the server sign-in (STACK.md §2.5).
const NPSSO_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/

export type ProbeTag =
  | 'npsso-invalid'
  | 'constants-unreadable'
  | 'manifest-entry-missing'
  | 'authorize-rejected'
  | 'authorize-unexpected'
  | 'token-unusable'
  | 'http-status'
  | 'query-rotated'
  | 'access-denied'
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

// One signed-in operation the owner can probe: which manifest entry it writes,
// which constants in `docs/contracts/sony-constants.json` name it, what a
// valid answer looks like, and where its image URLs are.
export interface SignedInProbe {
  readonly feature: 'purchased' | 'wishlist'
  readonly label: string
  readonly operationNameConstant: string
  readonly hashConstant: string
  readonly variables: Readonly<Record<string, unknown>>
  readonly isValidBody: (body: unknown) => boolean
  // The raw values of the image URL field of each list element. The server
  // decodes the same field into the card image (`crates/server/src/sources/
  // sony/account/`). The signed-in lists have no video field.
  readonly mediaUrls: (body: unknown) => readonly unknown[]
}

// The host names of the media URLs of one answer, for the CSP review (#162).
export interface MediaHosts {
  // Distinct host names, sorted.
  readonly hosts: readonly string[]
  // Values that are not an absolute `https:` URL with a host name.
  readonly invalid: number
}

export interface ProbeResult {
  readonly status: number
  readonly media: MediaHosts
}

const CONFIG_CONSTANTS = {
  graphqlUrl: 'SONY_GRAPHQL_URL',
  authBaseUrl: 'SONY_AUTH_BASE_URL',
  clientId: 'SONY_AUTH_CLIENT_ID',
  redirectUri: 'SONY_AUTH_REDIRECT_URI',
  scope: 'SONY_AUTH_SCOPE',
  basicHeader: 'SONY_AUTH_BASIC_HEADER',
  locale: 'SONY_LOCALE',
} as const satisfies Record<
  Exclude<keyof ProbeConfig, 'operationName' | 'hash'>,
  string
>

export const readProbeConfig = (
  sonyConstants: SonyConstants,
  probe: SignedInProbe = PURCHASED_PROBE,
): ProbeConfig => {
  const read = (constant: string): string => {
    const value = sonyConstant(sonyConstants, constant)
    if (value === null) {
      throw new ProbeFailure('constants-unreadable')
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
    operationName: read(probe.operationNameConstant),
    hash: read(probe.hashConstant),
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

// One-shot copy of the NPSSO exchange of the server's Sony account client
// (`src/sources/sony/account.rs` in the server crate), which owns the flow.
// Keep both in step. Returns the access token only.
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

const libraryEnvelopeSchema = z.object({
  data: z.object({
    purchasedTitlesRetrieve: z.object({
      games: z.array(z.unknown()),
    }),
  }),
})

const wishlistEnvelopeSchema = z.object({
  data: z.object({
    storeWishlistSecure: z.array(z.unknown()),
  }),
})

const isValid =
  (schema: z.ZodType) =>
  (body: unknown): boolean =>
    schema.safeParse(body).success

const jsonObjectSchema = z.record(z.string(), z.unknown())

// The value at `key` of a JSON object, or undefined for any other value.
const member = (value: unknown, key: string): unknown => {
  const parsed = jsonObjectSchema.safeParse(value)
  return parsed.success ? parsed.data[key] : undefined
}

// The `url` of the object at `imageKey` of each list element. The probe reads
// every element, also one that the server drops as out of scope: an extra
// host in the CSP review list breaks no image, but a missed host does.
const listImageUrls = (list: unknown, imageKey: string): unknown[] =>
  Array.isArray(list)
    ? list.map((element) => member(member(element, imageKey), 'url'))
    : []

const hostOf = (value: string): string | null => {
  try {
    const url = new URL(value)
    // The CSP allows images over `https:` only.
    return url.protocol === 'https:' && url.hostname !== ''
      ? url.hostname
      : null
  } catch {
    return null
  }
}

// An absent, `null`, or empty value is no image and is skipped. Any other
// value that gives no host is counted as invalid; its text is never kept.
export const collectMediaHosts = (values: readonly unknown[]): MediaHosts => {
  const hosts = new Set<string>()
  let invalid = 0
  for (const value of values) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    const host = typeof value === 'string' ? hostOf(value) : null
    if (host === null) {
      invalid += 1
    } else {
      hosts.add(host)
    }
  }
  return { hosts: [...hosts].sort(), invalid }
}

export const PURCHASED_PROBE: SignedInProbe = {
  feature: 'purchased',
  label: 'getPurchasedGameList',
  operationNameConstant: 'SONY_PURCHASED_OPERATION_NAME',
  hashConstant: 'SONY_PURCHASED_HASH',
  // One page of the server's page size (`PURCHASED_PAGE_SIZE`), so the media
  // host list covers up to 100 games, not a single one.
  variables: {
    isActive: true,
    platform: ['ps5'],
    size: 100,
    start: 0,
    sortBy: 'ACTIVE_DATE',
    sortDirection: 'desc',
  },
  isValidBody: isValid(libraryEnvelopeSchema),
  mediaUrls: (body) =>
    listImageUrls(
      member(member(member(body, 'data'), 'purchasedTitlesRetrieve'), 'games'),
      'image',
    ),
}

export const WISHLIST_PROBE: SignedInProbe = {
  feature: 'wishlist',
  label: 'storeRetrieveWishlist',
  operationNameConstant: 'SONY_WISHLIST_OPERATION_NAME',
  hashConstant: 'SONY_WISHLIST_HASH',
  variables: {},
  isValidBody: isValid(wishlistEnvelopeSchema),
  mediaUrls: (body) =>
    listImageUrls(
      member(member(body, 'data'), 'storeWishlistSecure'),
      'boxArt',
    ),
}

// Requests the operation once, read-only. Resolves with the HTTP status (always
// 200) and the media host names only when the response holds the valid list
// array for that operation. The body is not kept after the host names are read.
export const probeOperation = async (
  probe: SignedInProbe,
  accessToken: string,
  config: ProbeConfig,
  fetchFn: typeof fetch,
): Promise<ProbeResult> => {
  const query = new URLSearchParams({
    operationName: config.operationName,
    variables: JSON.stringify(probe.variables),
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
  const text = JSON.stringify(body).toLowerCase()
  if (text.includes('persistedquerynotfound')) {
    throw new ProbeFailure('query-rotated', response.status)
  }
  if (!probe.isValidBody(body)) {
    throw new ProbeFailure(
      text.includes('access denied') ? 'access-denied' : 'shape-drift',
      response.status,
    )
  }
  return {
    status: response.status,
    media: collectMediaHosts(probe.mediaUrls(body)),
  }
}

export const probePurchased = (
  accessToken: string,
  config: ProbeConfig,
  fetchFn: typeof fetch,
): Promise<ProbeResult> =>
  probeOperation(PURCHASED_PROBE, accessToken, config, fetchFn)

export const probeWishlist = (
  accessToken: string,
  config: ProbeConfig,
  fetchFn: typeof fetch,
): Promise<ProbeResult> =>
  probeOperation(WISHLIST_PROBE, accessToken, config, fetchFn)

// Sets the hash and the observed status of the entry for `feature`. Leaves the
// capture metadata untouched. Throws when the manifest has no such entry.
export const recordObservedStatus = (
  manifest: SonyContractManifest,
  hash: string,
  status: number,
  feature: SignedInProbe['feature'] = 'purchased',
): SonyContractManifest => {
  if (!manifest.operations.some((entry) => entry.feature === feature)) {
    throw new ProbeFailure('manifest-entry-missing')
  }
  return {
    ...manifest,
    operations: manifest.operations.map((entry) =>
      entry.feature === feature
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
  readonly constantsPath?: string
}

// An unreadable or invalid constants file is the same fixed failure as a
// missing constant.
const readProbeConstants = async (filePath: string): Promise<SonyConstants> => {
  try {
    return await readSonyConstants(filePath)
  } catch {
    throw new ProbeFailure('constants-unreadable')
  }
}

// The lines after PASS: the media host names for the CSP review (#162). Host
// names only, never a URL, a path, or a query. They go to standard output
// only and never to a file.
export const mediaHostLines = (label: string, media: MediaHosts): string[] => [
  `${label} media hosts ${String(media.hosts.length)}`,
  ...media.hosts.map((host) => `${label} media host ${host}`),
  `${label} invalid media urls ${String(media.invalid)}`,
]

// Owner-run check. Prints the operation name, the status code and PASS or
// FAIL; after PASS, the media host lines. Writes the manifest on PASS only,
// and only when its content changes.
const runProbe = async (
  probe: SignedInProbe,
  options: ProbeRunOptions,
): Promise<void> => {
  const {
    env = process.env,
    fetchFn = fetch,
    manifestPath = paths.canonicalManifest,
    constantsPath = paths.sonyConstants,
  } = options
  try {
    const npsso = parseNpsso(env['SONY_NPSSO'])
    const config = readProbeConfig(
      await readProbeConstants(constantsPath),
      probe,
    )
    const manifest = await readJsonFile<SonyContractManifest>(manifestPath)
    if (!manifest.operations.some((entry) => entry.feature === probe.feature)) {
      throw new ProbeFailure('manifest-entry-missing')
    }

    const accessToken = await exchangeNpsso(npsso, config, fetchFn)
    const { status, media } = await probeOperation(
      probe,
      accessToken,
      config,
      fetchFn,
    )
    const updated = recordObservedStatus(
      manifest,
      config.hash,
      status,
      probe.feature,
    )
    // A PASS that changes no value leaves the committed text untouched.
    if (!isDeepStrictEqual(updated, manifest)) {
      await writeFormattedJsonFile(manifestPath, updated)
    }
    console.info(`${probe.label} ${String(status)} PASS`)
    for (const line of mediaHostLines(probe.label, media)) {
      console.info(line)
    }
  } catch (error) {
    const tag = error instanceof ProbeFailure ? error.tag : 'unexpected'
    const status = error instanceof ProbeFailure ? error.status : null
    console.error(
      `${probe.label} ${status === null ? '-' : String(status)} FAIL (${tag})`,
    )
    process.exitCode = 1
  }
}

export const runProbePurchased = (
  options: ProbeRunOptions = {},
): Promise<void> => runProbe(PURCHASED_PROBE, options)

export const runProbeWishlist = (
  options: ProbeRunOptions = {},
): Promise<void> => runProbe(WISHLIST_PROBE, options)
