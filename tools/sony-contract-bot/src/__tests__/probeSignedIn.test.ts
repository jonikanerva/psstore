import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeNpsso,
  parseNpsso,
  probePurchased,
  probeWishlist,
  readProbeConfig,
  recordObservedStatus,
  runProbePurchased,
  runProbeWishlist,
  WISHLIST_PROBE,
  type ProbeConfig,
} from '../commands/probeSignedIn.js'
import { readJsonFile } from '../io/files.js'
import type { SonyContractManifest } from '../contract/types.js'

const NPSSO = 'synthetic-npsso-0123456789'
const CODE = 'synthetic-code-abc123'
const TOKEN = 'synthetic-token-xyz789'
const REDIRECT = 'com.example.app://redirect'
const HASH = '9'.repeat(64)
const WISHLIST_HASH = '7'.repeat(64)

const config: ProbeConfig = {
  graphqlUrl: 'https://graphql.example.invalid/op',
  authBaseUrl: 'https://auth.example.invalid/oauth',
  clientId: 'client-id',
  redirectUri: REDIRECT,
  scope: 'scope-a scope-b',
  basicHeader: 'Basic c3ludGhldGlj',
  operationName: 'getPurchasedGameList',
  hash: HASH,
  locale: 'en-fi',
}

const envText = [
  `export const SONY_GRAPHQL_URL =\n  '${config.graphqlUrl}'`,
  `export const SONY_AUTH_BASE_URL =\n  '${config.authBaseUrl}'`,
  `export const SONY_AUTH_CLIENT_ID = '${config.clientId}'`,
  `export const SONY_AUTH_REDIRECT_URI =\n  '${REDIRECT}'`,
  `export const SONY_AUTH_SCOPE = '${config.scope}'`,
  `export const SONY_AUTH_BASIC_HEADER =\n  '${config.basicHeader}'`,
  `export const SONY_PURCHASED_OPERATION_NAME = '${config.operationName}'`,
  `export const SONY_PURCHASED_HASH =\n  '${HASH}'`,
  "export const SONY_WISHLIST_OPERATION_NAME = 'storeRetrieveWishlist'",
  `export const SONY_WISHLIST_HASH =\n  '${WISHLIST_HASH}'`,
  "export const SONY_LOCALE = 'en-fi'",
].join('\n')

const redirect = (location: string | null): Response =>
  new Response(null, {
    status: 302,
    ...(location === null ? {} : { headers: { location } }),
  })
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })
const wishlistConfig: ProbeConfig = {
  ...config,
  operationName: 'storeRetrieveWishlist',
  hash: WISHLIST_HASH,
}
const okWishlist = { data: { storeWishlistSecure: [] } }
const okLibrary = { data: { purchasedTitlesRetrieve: { games: [] } } }

// Answers in call order.
const fetchOf = (...responses: Response[]): typeof fetch => {
  const queue = [...responses]
  return vi.fn<typeof fetch>(() => {
    const next = queue.shift()
    return next === undefined
      ? Promise.reject(new Error('unexpected extra request'))
      : Promise.resolve(next)
  })
}

const calls = (fetchFn: typeof fetch): Array<[string, RequestInit]> =>
  vi
    .mocked(fetchFn)
    .mock.calls.map(([input, init]) => [
      typeof input === 'string' ? input : '',
      init ?? {},
    ])

const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('expected a rejection')
}

describe('parseNpsso', () => {
  it('accepts a valid value', () => {
    expect(parseNpsso(NPSSO)).toBe(NPSSO)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', 'short-value'],
    ['bad characters', 'has space and !!! chars'],
    ['too long', 'a'.repeat(513)],
  ])('rejects %s without echoing the value', async (_name, value) => {
    const error = await rejection(
      Promise.resolve().then(() => parseNpsso(value)),
    )
    expect(error.message).toBe('probe failed: npsso-invalid')
    if (value !== undefined && value !== '') {
      expect(error.message).not.toContain(value)
    }
  })
})

describe('readProbeConfig', () => {
  it('reads every constant from the server env text', () => {
    expect(readProbeConfig(envText)).toEqual(config)
  })

  it('reads the wishlist operation constants for the wishlist probe', () => {
    expect(readProbeConfig(envText, WISHLIST_PROBE)).toEqual(wishlistConfig)
  })

  it('fails with a fixed tag when a constant is missing', () => {
    expect(() => readProbeConfig('nothing here')).toThrow(
      'probe failed: env-unreadable',
    )
  })
})

describe('exchangeNpsso', () => {
  const goodFlow = (): typeof fetch =>
    fetchOf(
      redirect(`${REDIRECT}?code=${CODE}&cid=1`),
      json({ access_token: TOKEN, refresh_token: 'ignored' }),
    )

  it('sends the cookie with a manual redirect and returns the token', async () => {
    const fetchFn = goodFlow()
    await expect(exchangeNpsso(NPSSO, config, fetchFn)).resolves.toBe(TOKEN)

    const [authorize, token] = calls(fetchFn)
    expect(authorize?.[0]).toContain(`${config.authBaseUrl}/authorize?`)
    expect(authorize?.[1].redirect).toBe('manual')
    expect(new Headers(authorize?.[1].headers).get('cookie')).toBe(
      `npsso=${NPSSO}`,
    )
    expect(authorize?.[1].signal).toBeInstanceOf(AbortSignal)
    expect(token?.[0]).toBe(`${config.authBaseUrl}/token`)
    const tokenBody = token?.[1].body
    expect(typeof tokenBody === 'string' ? tokenBody : '').toContain(
      `code=${CODE}`,
    )
    expect(token?.[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects a 302 without a code', async () => {
    const error = await rejection(
      exchangeNpsso(NPSSO, config, fetchOf(redirect(`${REDIRECT}?error=x`))),
    )
    expect(error.message).toBe('probe failed: authorize-rejected')
  })

  it('rejects a 302 to another target', async () => {
    const error = await rejection(
      exchangeNpsso(
        NPSSO,
        config,
        fetchOf(redirect(`https://other.invalid/?code=${CODE}`)),
      ),
    )
    expect(error.message).toBe('probe failed: authorize-rejected')
  })

  it('treats a non-302 answer as unexpected', async () => {
    const error = await rejection(
      exchangeNpsso(NPSSO, config, fetchOf(json({}, 200))),
    )
    expect(error.message).toBe('probe failed: authorize-unexpected')
  })

  it('rejects a token response without access_token', async () => {
    const error = await rejection(
      exchangeNpsso(
        NPSSO,
        config,
        fetchOf(redirect(`${REDIRECT}?code=${CODE}`), json({ other: 1 })),
      ),
    )
    expect(error.message).toBe('probe failed: token-unusable')
  })
})

describe('probePurchased', () => {
  it('sends the bearer token, operation name and hash, size 1', async () => {
    const fetchFn = fetchOf(json(okLibrary))
    await expect(probePurchased(TOKEN, config, fetchFn)).resolves.toBe(200)

    const [url = '', init] = calls(fetchFn)[0] ?? []
    const parsed = new URL(url)
    expect(parsed.searchParams.get('operationName')).toBe(
      'getPurchasedGameList',
    )
    expect(parsed.searchParams.get('extensions')).toContain(HASH)
    expect(
      JSON.parse(parsed.searchParams.get('variables') ?? ''),
    ).toMatchObject({
      size: 1,
      start: 0,
      platform: ['ps5'],
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('x-apollo-operation-name')).toBe('getPurchasedGameList')
    expect(headers.get('x-psn-store-locale-override')).toBe('en-FI')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([401, 403, 500])('rejects HTTP %i', async (status) => {
    const error = await rejection(
      probePurchased(TOKEN, config, fetchOf(json({}, status))),
    )
    expect(error.message).toBe('probe failed: http-status')
  })

  it('rejects a persisted query rotation', async () => {
    const error = await rejection(
      probePurchased(
        TOKEN,
        config,
        fetchOf(json({ errors: [{ message: 'PersistedQueryNotFound' }] })),
      ),
    )
    expect(error.message).toBe('probe failed: query-rotated')
  })

  it.each([
    { data: { purchasedTitlesRetrieve: null } },
    { data: { purchasedTitlesRetrieve: { games: 'x' } } },
    { data: {} },
    {},
  ])('rejects a response without a games array: %j', async (body) => {
    const error = await rejection(
      probePurchased(TOKEN, config, fetchOf(json(body))),
    )
    expect(error.message).toBe('probe failed: shape-drift')
  })
})

describe('probeWishlist', () => {
  it('sends one read-only GET with empty variables and the bearer token', async () => {
    const fetchFn = fetchOf(json(okWishlist))
    await expect(probeWishlist(TOKEN, wishlistConfig, fetchFn)).resolves.toBe(
      200,
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url = '', init] = calls(fetchFn)[0] ?? []
    const parsed = new URL(url)
    expect(init?.method).toBe('GET')
    expect(parsed.searchParams.get('operationName')).toBe(
      'storeRetrieveWishlist',
    )
    expect(parsed.searchParams.get('variables')).toBe('{}')
    expect(parsed.searchParams.get('extensions')).toContain(WISHLIST_HASH)
    expect(url).not.toContain('removeWishlistItem')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('x-apollo-operation-name')).toBe('storeRetrieveWishlist')
  })

  it.each([401, 403, 400, 500])('rejects HTTP %i', async (status) => {
    const error = await rejection(
      probeWishlist(TOKEN, wishlistConfig, fetchOf(json({}, status))),
    )
    expect(error.message).toBe('probe failed: http-status')
  })

  it('rejects a persisted query rotation', async () => {
    const error = await rejection(
      probeWishlist(
        TOKEN,
        wishlistConfig,
        fetchOf(json({ errors: [{ message: 'PersistedQueryNotFound' }] })),
      ),
    )
    expect(error.message).toBe('probe failed: query-rotated')
  })

  it('reports access denied with a null list as its own tag', async () => {
    const error = await rejection(
      probeWishlist(
        TOKEN,
        wishlistConfig,
        fetchOf(
          json({
            errors: [{ message: 'Access denied! You need to be authorized.' }],
            data: { storeWishlistSecure: null },
          }),
        ),
      ),
    )
    expect(error.message).toBe('probe failed: access-denied')
  })

  it.each([
    { data: { storeWishlistSecure: null } },
    { data: { storeWishlistSecure: {} } },
    { data: {} },
    {},
  ])('rejects a response without a list array: %j', async (body) => {
    const error = await rejection(
      probeWishlist(TOKEN, wishlistConfig, fetchOf(json(body))),
    )
    expect(error.message).toBe('probe failed: shape-drift')
  })
})

const manifestWith = (observed: number[]): SonyContractManifest => ({
  version: 1,
  metadata: {
    captured_at: '2026-10-03T00:00:00.000Z',
    captured_by: 'test',
    region: 'fi',
    locale: 'fi-fi',
    currency: 'EUR',
    target_platform: 'PS5',
    playwright_profile: 'default',
  },
  endpoint: { url: config.graphqlUrl, method: 'GET' },
  operations: [
    {
      feature: 'purchased',
      operation_name: 'getPurchasedGameList',
      persisted_query_hash: 'a'.repeat(64),
      required_headers: ['x-apollo-operation-name'],
      variables_schema: {},
      sample_variables: {},
      response_path: 'data.purchasedTitlesRetrieve.games',
      observed_status_codes: observed,
    },
    {
      feature: 'wishlist',
      operation_name: 'storeRetrieveWishlist',
      persisted_query_hash: 'c'.repeat(64),
      required_headers: ['x-apollo-operation-name'],
      variables_schema: {},
      sample_variables: {},
      response_path: 'data.storeWishlistSecure',
      observed_status_codes: [],
    },
    {
      feature: 'search',
      operation_name: 'getSearchResults',
      persisted_query_hash: 'b'.repeat(64),
      required_headers: ['x-apollo-operation-name'],
      variables_schema: {},
      sample_variables: {},
      response_path: 'data.universalSearch',
      observed_status_codes: [200],
    },
  ],
})

describe('recordObservedStatus', () => {
  it('sets hash and status on the purchased entry only', () => {
    const before = manifestWith([])
    const after = recordObservedStatus(before, HASH, 200)
    expect(after.operations[0]).toMatchObject({
      persisted_query_hash: HASH,
      observed_status_codes: [200],
    })
    expect(after.operations[1]).toEqual(before.operations[1])
    expect(after.metadata).toEqual(before.metadata)
    expect(before.operations[0]?.observed_status_codes).toEqual([])
  })

  it('sets hash and status on the wishlist entry only', () => {
    const before = manifestWith([])
    const after = recordObservedStatus(before, WISHLIST_HASH, 200, 'wishlist')
    expect(after.operations[1]).toMatchObject({
      feature: 'wishlist',
      persisted_query_hash: WISHLIST_HASH,
      observed_status_codes: [200],
    })
    expect(after.operations[0]).toEqual(before.operations[0])
    expect(after.operations[2]).toEqual(before.operations[2])
  })

  it('throws when the manifest has no purchased entry', () => {
    const before = manifestWith([])
    expect(() =>
      recordObservedStatus(
        { ...before, operations: before.operations.slice(1) },
        HASH,
        200,
      ),
    ).toThrow('probe failed: manifest-entry-missing')
  })
})

describe('runProbePurchased', () => {
  let dir = ''
  let manifestPath = ''
  let envFilePath = ''
  const output: string[] = []

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-'))
    manifestPath = path.join(dir, 'manifest.json')
    envFilePath = path.join(dir, 'env.ts')
    await fs.writeFile(envFilePath, envText)
    await fs.writeFile(manifestPath, JSON.stringify(manifestWith([])))
    output.length = 0
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(' '))
      })
    }
    process.exitCode = undefined
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    process.exitCode = undefined
    await fs.rm(dir, { recursive: true, force: true })
  })

  const run = (fetchFn: typeof fetch, npsso: string | undefined = NPSSO) =>
    runProbePurchased({
      env: { SONY_NPSSO: npsso },
      fetchFn,
      manifestPath,
      envFilePath,
    })

  const readManifest = async (): Promise<SonyContractManifest> =>
    readJsonFile<SonyContractManifest>(manifestPath)

  const secretsAbsent = async (): Promise<void> => {
    const written = await fs.readFile(manifestPath, 'utf8')
    for (const secret of [NPSSO, CODE, TOKEN]) {
      expect(output.join('\n')).not.toContain(secret)
      expect(written).not.toContain(secret)
    }
  }

  it('records 200 and prints PASS on success', async () => {
    await run(
      fetchOf(
        redirect(`${REDIRECT}?code=${CODE}`),
        json({ access_token: TOKEN }),
        json(okLibrary),
      ),
    )
    const written = await readManifest()
    expect(written.operations[0]?.observed_status_codes).toEqual([200])
    expect(written.operations[0]?.persisted_query_hash).toBe(HASH)
    expect(written.metadata.captured_at).toBe('2026-10-03T00:00:00.000Z')
    expect(output).toEqual(['getPurchasedGameList 200 PASS'])
    expect(process.exitCode).toBeUndefined()
    await secretsAbsent()
  })

  it('makes no request and writes nothing for an invalid NPSSO', async () => {
    const fetchFn = fetchOf()
    await run(fetchFn, 'bad value')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(output).toEqual(['getPurchasedGameList - FAIL (npsso-invalid)'])
    expect(process.exitCode).toBe(1)
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(
      JSON.stringify(manifestWith([])),
    )
  })

  it('prints a fixed FAIL line and writes nothing on a library failure', async () => {
    await run(
      fetchOf(
        redirect(`${REDIRECT}?code=${CODE}`),
        json({ access_token: TOKEN }),
        json({}, 401),
      ),
    )
    expect(output).toEqual(['getPurchasedGameList 401 FAIL (http-status)'])
    expect(process.exitCode).toBe(1)
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(
      JSON.stringify(manifestWith([])),
    )
    await secretsAbsent()
  })

  it('prints only the tag when a request throws with a secret in its message', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error(`boom ${NPSSO} ${CODE} ${TOKEN}`)),
    )
    await run(fetchFn)
    expect(output).toEqual(['getPurchasedGameList - FAIL (unexpected)'])
    await secretsAbsent()
  })

  it('fails before any request when the manifest has no purchased entry', async () => {
    const before = manifestWith([])
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ ...before, operations: before.operations.slice(1) }),
    )
    const fetchFn = fetchOf()
    await run(fetchFn)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(output).toEqual([
      'getPurchasedGameList - FAIL (manifest-entry-missing)',
    ])
  })
})

describe('runProbeWishlist', () => {
  let dir = ''
  let manifestPath = ''
  let envFilePath = ''
  const output: string[] = []

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-wish-'))
    manifestPath = path.join(dir, 'manifest.json')
    envFilePath = path.join(dir, 'env.ts')
    await fs.writeFile(envFilePath, envText)
    await fs.writeFile(manifestPath, JSON.stringify(manifestWith([])))
    output.length = 0
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(' '))
      })
    }
    process.exitCode = undefined
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    process.exitCode = undefined
    await fs.rm(dir, { recursive: true, force: true })
  })

  const run = (fetchFn: typeof fetch, npsso: string | undefined = NPSSO) =>
    runProbeWishlist({
      env: { SONY_NPSSO: npsso },
      fetchFn,
      manifestPath,
      envFilePath,
    })

  it('records 200 on the wishlist entry and prints PASS', async () => {
    await run(
      fetchOf(
        redirect(`${REDIRECT}?code=${CODE}`),
        json({ access_token: TOKEN }),
        json(okWishlist),
      ),
    )
    const written = await readJsonFile<SonyContractManifest>(manifestPath)
    expect(written.operations[1]).toMatchObject({
      feature: 'wishlist',
      persisted_query_hash: WISHLIST_HASH,
      observed_status_codes: [200],
    })
    expect(written.operations[0]?.observed_status_codes).toEqual([])
    expect(output).toEqual(['storeRetrieveWishlist 200 PASS'])
    expect(process.exitCode).toBeUndefined()
    const text = await fs.readFile(manifestPath, 'utf8')
    for (const secret of [NPSSO, CODE, TOKEN]) {
      expect(output.join('\n')).not.toContain(secret)
      expect(text).not.toContain(secret)
    }
  })

  it('writes nothing and prints a fixed FAIL line when Sony denies access', async () => {
    await run(
      fetchOf(
        redirect(`${REDIRECT}?code=${CODE}`),
        json({ access_token: TOKEN }),
        json({
          errors: [{ message: 'Access denied!' }],
          data: { storeWishlistSecure: null },
        }),
      ),
    )
    expect(output).toEqual(['storeRetrieveWishlist 200 FAIL (access-denied)'])
    expect(process.exitCode).toBe(1)
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(
      JSON.stringify(manifestWith([])),
    )
  })

  it('makes no request for an invalid NPSSO', async () => {
    const fetchFn = fetchOf()
    await run(fetchFn, 'bad value')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(output).toEqual(['storeRetrieveWishlist - FAIL (npsso-invalid)'])
  })
})
