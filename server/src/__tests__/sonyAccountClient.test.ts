import { Effect, Exit, Redacted } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SONY_AUTH_REDIRECT_URI,
  SONY_PURCHASED_MAX_PAGES,
  SONY_PURCHASED_PAGE_SIZE,
  SONY_WISHLIST_HASH,
} from '../config/env.js'
import { SonyAccountClient, SonyAccountClientLive } from '../sony/sonyClient.js'

const NPSSO = 'synthetic-npsso-0123456789'
const CODE = 'v3.synthetic-code'
const TOKEN = 'synthetic-access-token'

const realFetch = globalThis.fetch

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

const redirect = (location: string | null): Response =>
  new Response(null, {
    status: 302,
    headers: location === null ? {} : { location },
  })

const tokenBody = (): Response =>
  Response.json({
    access_token: TOKEN,
    refresh_token: 'synthetic-refresh',
    id_token: 'synthetic-id',
    expires_in: 3599,
  })

const exchange = (): Promise<Exit.Exit<Redacted.Redacted, { _tag: string }>> =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* SonyAccountClient
      return yield* client.exchangeNpsso(Redacted.make(NPSSO))
    }).pipe(Effect.provide(SonyAccountClientLive)),
  )

const library = () =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* SonyAccountClient
      return yield* client.fetchPurchasedGames(Redacted.make(TOKEN))
    }).pipe(Effect.provide(SonyAccountClientLive)),
  )

const wishlist = () =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* SonyAccountClient
      return yield* client.fetchWishlistGames(Redacted.make(TOKEN))
    }).pipe(Effect.provide(SonyAccountClientLive)),
  )

const tagOf = (exit: Exit.Exit<unknown, { _tag: string }>): string | null =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === 'Fail'
    ? exit.cause.reasons[0].error._tag
    : null

type FetchCall = Parameters<typeof fetch>

const urlOf = (call: FetchCall | undefined): string => {
  const input = call?.[0]
  if (input === undefined) return ''
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const startOf = (call: FetchCall): number => {
  const raw = new URL(urlOf(call)).searchParams.get('variables') ?? '{}'
  const parsed: unknown = JSON.parse(raw)
  return typeof parsed === 'object' &&
    parsed !== null &&
    'start' in parsed &&
    typeof parsed.start === 'number'
    ? parsed.start
    : -1
}

const gameRow = (index: number): unknown => ({
  conceptId: String(index),
  name: `Synthetic ${String(index)}`,
  platform: 'PS5',
  productId: `EP0001-PPSA${String(index).padStart(5, '0')}_00-SYNTHETIC${String(index).padStart(7, '0')}`,
  image: { url: 'https://img.test/x.png' },
})

const libraryPage = (from: number, count: number): Response =>
  Response.json({
    data: {
      purchasedTitlesRetrieve: {
        games: Array.from({ length: count }, (_, i) => gameRow(from + i)),
      },
    },
  })

describe('exchangeNpsso', () => {
  it('follows no redirect, sends the cookie once and returns the token', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        redirect(`${SONY_AUTH_REDIRECT_URI}/?code=${CODE}`),
      )
      .mockResolvedValueOnce(tokenBody())
    globalThis.fetch = fetchMock

    const result = await exchange()
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(Redacted.value(result.value)).toBe(TOKEN)
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const authorizeInit = fetchMock.mock.calls[0]?.[1]
    expect(urlOf(fetchMock.mock.calls[0])).toContain('/authorize?')
    expect(authorizeInit?.redirect).toBe('manual')
    expect(authorizeInit?.headers).toEqual({ Cookie: `npsso=${NPSSO}` })
    const tokenInit = fetchMock.mock.calls[1]?.[1]
    expect(tokenInit?.body).toContain(`code=${encodeURIComponent(CODE)}`)
  })

  it('maps a redirect without a code to SessionRejected', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirect('https://login.example.test/signin'))
    expect(tagOf(await exchange())).toBe('SessionRejected')
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(redirect(null))
    expect(tagOf(await exchange())).toBe('SessionRejected')
  })

  it('maps a non-302 answer to UpstreamUnavailable', async () => {
    for (const status of [200, 301, 307]) {
      globalThis.fetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }))
      expect(tagOf(await exchange()), String(status)).toBe(
        'UpstreamUnavailable',
      )
    }
  })

  it('maps 5xx to UpstreamUnavailable without a retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }))
    globalThis.fetch = fetchMock
    expect(tagOf(await exchange())).toBe('UpstreamUnavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a 4xx on authorize to UpstreamUnavailable, not a rejection', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }))
    expect(tagOf(await exchange())).toBe('UpstreamUnavailable')
  })

  it('maps 429 to UpstreamRateLimited without a retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }))
    globalThis.fetch = fetchMock
    expect(tagOf(await exchange())).toBe('UpstreamRateLimited')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps 401 and 403 on the token call to SessionRejected, never retried', async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          redirect(`${SONY_AUTH_REDIRECT_URI}/?code=${CODE}`),
        )
        .mockResolvedValue(new Response(null, { status }))
      globalThis.fetch = fetchMock
      expect(tagOf(await exchange()), String(status)).toBe('SessionRejected')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  })

  it('maps a token body without an access token to UpstreamUnavailable', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        redirect(`${SONY_AUTH_REDIRECT_URI}/?code=${CODE}`),
      )
      .mockResolvedValueOnce(Response.json({ error: 'x' }))
    expect(tagOf(await exchange())).toBe('UpstreamUnavailable')
  })

  it('keeps the redirect target and the token out of error text', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirect(`https://login.example.test/?code=${CODE}`))
    const result = await exchange()
    expect(JSON.stringify(result)).not.toContain(CODE)
    expect(JSON.stringify(result)).not.toContain(NPSSO)
  })
})

describe('fetchPurchasedGames', () => {
  it('requests PS5 with the persisted query and a bearer token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(libraryPage(1, 2))
    globalThis.fetch = fetchMock
    const result = await library()
    expect(Exit.isSuccess(result) && result.value).toHaveLength(2)
    const init = fetchMock.mock.calls[0]?.[1]
    const params = new URL(urlOf(fetchMock.mock.calls[0])).searchParams
    expect(params.get('operationName')).toBe('getPurchasedGameList')
    expect(JSON.parse(params.get('variables') ?? '{}')).toMatchObject({
      platform: ['ps5'],
      size: SONY_PURCHASED_PAGE_SIZE,
      start: 0,
    })
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
  })

  it('crawls pages in order until a short page and de-duplicates', async () => {
    const size = SONY_PURCHASED_PAGE_SIZE
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(libraryPage(0, size))
      .mockResolvedValueOnce(libraryPage(size - 1, 3))
    globalThis.fetch = fetchMock
    const result = await library()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(startOf)).toEqual([0, size])
    // Row size - 1 appears on both pages: it is kept once.
    expect(Exit.isSuccess(result) && result.value).toHaveLength(size + 2)
  })

  it('fails loudly when the page cap is reached with a full last page', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(libraryPage(0, SONY_PURCHASED_PAGE_SIZE)),
      )
    globalThis.fetch = fetchMock
    const result = await library()
    expect(tagOf(result)).toBe('UpstreamUnavailable')
    expect(fetchMock).toHaveBeenCalledTimes(SONY_PURCHASED_MAX_PAGES)
  })

  it('fails the whole request when a later page fails', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(libraryPage(0, SONY_PURCHASED_PAGE_SIZE))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    expect(tagOf(await library())).toBe('UpstreamUnavailable')
  })

  it('maps 401 and 403 to SessionRejected, 429 to a rate limit', async () => {
    for (const [status, tag] of [
      [401, 'SessionRejected'],
      [403, 'SessionRejected'],
      [429, 'UpstreamRateLimited'],
      [502, 'UpstreamUnavailable'],
    ] as const) {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }))
      globalThis.fetch = fetchMock
      expect(tagOf(await library()), String(status)).toBe(tag)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('maps a rotated hash and an unknown envelope', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        errors: [{ extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
      }),
    )
    expect(tagOf(await library())).toBe('UpstreamQueryRotated')
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { somethingElse: [] } }))
    expect(tagOf(await library())).toBe('UpstreamUnavailable')
  })

  it('maps a crawl that outlives the deadline to UpstreamUnavailable', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(libraryPage(0, SONY_PURCHASED_PAGE_SIZE))
          }, 5000)
        }),
    )
    const pending = library()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tagOf(await pending)).toBe('UpstreamUnavailable')
  })
})

describe('fetchWishlistGames', () => {
  const wishlistBody = (list: unknown): Response =>
    Response.json({ data: { storeWishlistSecure: list } })
  const wishRow = (id: string, platforms: string[] = ['PS5']): unknown => ({
    __typename: 'Concept',
    id,
    name: `Synthetic ${id}`,
    platforms,
    boxArt: { url: 'https://img.test/x.png' },
  })

  it('makes one GET with the persisted query, a bearer token and the locale', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(wishlistBody([wishRow('1'), wishRow('2', ['PS4'])]))
    globalThis.fetch = fetchMock
    const result = await wishlist()
    expect(Exit.isSuccess(result) && result.value).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    const params = new URL(urlOf(fetchMock.mock.calls[0])).searchParams
    expect(init?.method).toBe('GET')
    expect(params.get('operationName')).toBe('storeRetrieveWishlist')
    expect(params.get('variables')).toBe('{}')
    expect(JSON.parse(params.get('extensions') ?? '{}')).toEqual({
      persistedQuery: { version: 1, sha256Hash: SONY_WISHLIST_HASH },
    })
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'x-psn-store-locale-override': 'en-FI',
    })
  })

  it('treats an empty list as success', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(wishlistBody([]))
    const result = await wishlist()
    expect(Exit.isSuccess(result) && result.value).toEqual([])
  })

  it('maps a GraphQL access denied answer to SessionRejected', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        errors: [{ message: 'Access denied! You need to be authorized.' }],
        data: { storeWishlistSecure: null },
      }),
    )
    expect(tagOf(await wishlist())).toBe('SessionRejected')
  })

  it('maps a null or missing list without a denial to UpstreamUnavailable', async () => {
    for (const body of [
      { data: { storeWishlistSecure: null } },
      { data: {} },
      { data: null },
      {},
      { errors: [{ message: 'Internal error' }], data: null },
    ]) {
      globalThis.fetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body))
      expect(tagOf(await wishlist()), JSON.stringify(body)).toBe(
        'UpstreamUnavailable',
      )
    }
  })

  it('maps HTTP statuses, never retrying', async () => {
    for (const [status, tag] of [
      [401, 'SessionRejected'],
      [403, 'SessionRejected'],
      [400, 'UpstreamQueryRotated'],
      [429, 'UpstreamRateLimited'],
      [500, 'UpstreamUnavailable'],
      [502, 'UpstreamUnavailable'],
    ] as const) {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }))
      globalThis.fetch = fetchMock
      expect(tagOf(await wishlist()), String(status)).toBe(tag)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('maps a rotated hash reported in the body', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        errors: [{ extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
      }),
    )
    expect(tagOf(await wishlist())).toBe('UpstreamQueryRotated')
  })

  it('maps a network failure and a body that is not JSON to UpstreamUnavailable', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('network down'))
    expect(tagOf(await wishlist())).toBe('UpstreamUnavailable')
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>', { status: 200 }))
    expect(tagOf(await wishlist())).toBe('UpstreamUnavailable')
  })

  it('maps a call that outlives the deadline to UpstreamUnavailable', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(wishlistBody([]))
          }, 60_000)
        }),
    )
    const pending = wishlist()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(tagOf(await pending)).toBe('UpstreamUnavailable')
  })

  it('keeps names, ids and the token out of the error', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(wishlistBody({ unexpected: 'Synthetic 77' }))
    const text = JSON.stringify(await wishlist())
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('Synthetic 77')
  })
})
