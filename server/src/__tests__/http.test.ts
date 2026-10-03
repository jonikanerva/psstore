import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SONY_RETRY_AFTER_MAX_MS } from '../config/env.js'
import {
  fetchWithRetry,
  HttpStatusError,
  parseRetryAfterMs,
  RateLimitedError,
} from '../lib/http.js'

describe('parseRetryAfterMs', () => {
  it('parses a sane small delta-seconds value to milliseconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000)
    expect(parseRetryAfterMs('0')).toBe(0)
    expect(parseRetryAfterMs('  5  ')).toBe(5000)
  })

  it('clamps a hostile huge value to the bounded ceiling', () => {
    // A multi-minute Retry-After must never stall the request hot path.
    expect(parseRetryAfterMs('600')).toBe(SONY_RETRY_AFTER_MAX_MS)
    expect(parseRetryAfterMs('999999')).toBe(SONY_RETRY_AFTER_MAX_MS)
  })

  it('returns null for absent / malformed / HTTP-date values (never NaN)', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('')).toBeNull()
    expect(parseRetryAfterMs('-3')).toBeNull()
    expect(parseRetryAfterMs('1.5')).toBeNull()
    expect(parseRetryAfterMs('soon')).toBeNull()
    // HTTP-date form is intentionally not parsed.
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull()
  })
})

describe('fetchWithRetry 429 handling', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  const rateLimited = (retryAfter?: string): Response =>
    new Response('rate limited', {
      status: 429,
      headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
    })

  it('retries a 429 exactly once honouring the clamped delay, then throws the sentinel', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited('2'))
      .mockResolvedValueOnce(rateLimited('2'))
    globalThis.fetch = fetchMock

    const promise = fetchWithRetry('https://sony.test/op', {}, 6000, 1)
    // Capture the outcome up front so the rejected promise is observed before
    // timers advance (avoids an unhandled-rejection warning under fake timers).
    const settled = promise.then(
      (): unknown => null,
      (error: unknown): unknown => error,
    )

    // First attempt resolves to 429; the loop must wait the 2s clamped delay
    // before the single retry.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2000)
    const error = await settled

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(RateLimitedError)
    if (error instanceof RateLimitedError) {
      expect(error.kind).toBe('rate-limited')
      expect(error.retryAfterMs).toBe(2000)
    }
  })

  it('retries immediately (no sleep) when Retry-After is absent', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock

    const promise = fetchWithRetry('https://sony.test/op', {}, 6000, 1)
    await vi.advanceTimersByTimeAsync(0)
    const response = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(200)
  })
})

describe('fetchWithRetry status handling', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('returns a 3xx answer when redirects are handled manually', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302 }))
    const response = await fetchWithRetry(
      'https://sony.test/op',
      { redirect: 'manual' },
      6000,
      0,
    )
    expect(response.status).toBe(302)
  })

  it('treats a 3xx answer as a failure when redirects are followed', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302 }))
    await expect(
      fetchWithRetry('https://sony.test/op', {}, 6000, 0),
    ).rejects.toBeInstanceOf(HttpStatusError)
  })

  it('never retries a 4xx answer and reports its status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }))
    globalThis.fetch = fetchMock
    const error = await fetchWithRetry(
      'https://sony.test/op',
      {},
      6000,
      3,
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HttpStatusError)
    expect(error instanceof HttpStatusError && error.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still retries a 5xx answer within the retry budget', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock
    const response = await fetchWithRetry('https://sony.test/op', {}, 6000, 1)
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
