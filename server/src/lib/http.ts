// Low-level fetch with timeout + bounded retry. This is the dumb transport edge:
// it throws plain Errors (and the structured RateLimitedError sentinel below) on
// exhaustion / non-2xx; the SonyClient service catches them and maps them onto
// the typed Effect error channel. It deliberately does NOT import errors.ts —
// transport stays decoupled from the domain error model (STACK.md §0 layering).

import { SONY_RETRY_AFTER_MAX_MS } from '../config/env.js'

// Structured sentinel thrown when a 429 outlives the retry budget. The service
// layer pattern-matches the `kind` discriminant / instance (never the message
// string) and maps it to the typed `UpstreamRateLimited` error.
export class RateLimitedError extends Error {
  // `as const` is a const assertion (narrowing), not a type-bypassing cast —
  // ESLint's prefer-as-const requires this form over a literal annotation.
  readonly kind = 'rate-limited' as const
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('Sony upstream returned 429 (rate limited)')
    this.name = 'RateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Upstream unavailable'
}

/**
 * Parse an HTTP `Retry-After` header into a bounded millisecond delay.
 *
 * Only the numeric delta-seconds form (RFC 9110) is honoured. An absent,
 * non-numeric, negative, or HTTP-date value returns `null` (the caller retries
 * immediately rather than guessing) — we never sleep on `NaN` and never parse
 * exotic forms. A sane value is clamped to `SONY_RETRY_AFTER_MAX_MS` so a
 * hostile multi-minute header can never stall the request hot path.
 *
 * Pure and exported for unit testing.
 */
export const parseRetryAfterMs = (
  headerValue: string | null,
): number | null => {
  if (headerValue === null) {
    return null
  }
  const trimmed = headerValue.trim()
  // Delta-seconds is a run of ASCII digits only; reject HTTP-date and every
  // other form (Number() would coerce "" → 0 and parse leading-numeric loosely).
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const seconds = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  return Math.min(seconds * 1000, SONY_RETRY_AFTER_MAX_MS)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const fetchWithRetry = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
  retries: number,
): Promise<Response> => {
  let attempt = 0
  let lastError: unknown

  while (attempt <= retries) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timer)

      // 429 is a distinct failure mode: honour a bounded Retry-After before the
      // single retry, then surface the structured sentinel so the service maps
      // it to UpstreamRateLimited (HTTP 503) rather than a generic 502. Thrown
      // (not returned) so it never flows out as a successful Response.
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get('retry-after'),
        )
        if (attempt < retries) {
          attempt += 1
          if (retryAfterMs !== null && retryAfterMs > 0) {
            await sleep(retryAfterMs)
          }
          continue
        }
        throw new RateLimitedError(retryAfterMs)
      }

      if (!response.ok) {
        throw new Error(`Sony upstream returned ${String(response.status)}`)
      }

      return response
    } catch (error) {
      clearTimeout(timer)
      // The rate-limited sentinel is terminal — propagate it verbatim so the
      // service can pattern-match it, rather than flattening it into a generic
      // error on the loop's final throw.
      if (error instanceof RateLimitedError) {
        throw error
      }
      lastError = error
      attempt += 1
    }
  }

  throw new Error(describeError(lastError))
}
