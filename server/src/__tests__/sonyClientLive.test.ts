import { Effect, Exit, Logger } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SonyClient, SonyClientLive } from '../sony/sonyClient.js'

// Drive the real SonyClientLive (the network boundary) with a stubbed global
// fetch, so the rotation / drift / rate-limit classification is exercised
// end-to-end through the Effect layer — not just the pure helpers.

const realFetch = globalThis.fetch

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

// A capturing logger collects every log entry so a drift WARN can be asserted.
interface CapturedLog {
  readonly level: string
  readonly text: string
}

const withCapturedLogs = <A, E>(
  effect: Effect.Effect<A, E, SonyClient>,
): { exit: Promise<Exit.Exit<A, E>>; logs: CapturedLog[] } => {
  const logs: CapturedLog[] = []
  const capturing = Logger.make(({ logLevel, message }) => {
    logs.push({ level: logLevel, text: JSON.stringify(message) })
  })
  const exit = Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(SonyClientLive),
      Effect.provide(Logger.layer([capturing])),
    ),
  )
  return { exit, logs }
}

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('SonyClientLive classification', () => {
  it('degrades a drift response to [] AND fires a drift warning', async () => {
    // Absent categoryGridRetrieve node = corrupt/drift grid.
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: {} }))

    const { exit, logs } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) => client.fetchConceptsByFeature('new', 10)),
      ),
    )
    const result = await exit

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toEqual([])
    }
    // The operator gets an honest signal: a WARN carrying the drift marker.
    const driftWarn = logs.find(
      (entry) =>
        entry.level === 'Warn' &&
        entry.text.includes('sony.categoryGrid.drift'),
    )
    expect(driftWarn).toBeDefined()
  })

  it('does NOT warn for a present-but-empty grid', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ data: { categoryGridRetrieve: { concepts: [] } } }),
      )

    const { exit, logs } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) => client.fetchConceptsByFeature('new', 10)),
      ),
    )
    const result = await exit

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toEqual([])
    }
    expect(
      logs.some((entry) => entry.text.includes('sony.categoryGrid.drift')),
    ).toBe(false)
  })

  it('keeps good items but logs an element-drift warning when one element is broken', async () => {
    // Real-world failure mode: a single odd element must never empty the grid.
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          categoryGridRetrieve: {
            concepts: [
              {
                id: '1',
                name: 'Good',
                price: null,
                products: [{ id: 'EP0001-PPSA00001_00-GOOD000000000000' }],
              },
              { id: { wrong: true }, name: 'Broken' },
            ],
          },
        },
      }),
    )

    const { exit, logs } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) => client.fetchConceptsByFeature('new', 10)),
      ),
    )
    const result = await exit

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0]?.name).toBe('Good')
    }
    const elementDrift = logs.find(
      (entry) =>
        entry.level === 'Warn' &&
        entry.text.includes('sony.categoryGrid.elementDrift'),
    )
    expect(elementDrift).toBeDefined()
  })

  it('maps a persisted-query rotation to UpstreamQueryRotated', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        errors: [{ extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
      }),
    )

    const { exit } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) => client.fetchConceptsByFeature('new', 10)),
      ),
    )
    const result = await exit

    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(JSON.stringify(result.cause)).toContain('UpstreamQueryRotated')
    }
  })

  it('maps a rotation on the product path to UpstreamQueryRotated', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        errors: [{ message: 'PersistedQueryNotFound' }],
      }),
    )

    const { exit } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) =>
          client.fetchProductDetail('EP0001-PPSA00001_00-ALPHA00000000000'),
        ),
      ),
    )
    const result = await exit

    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(JSON.stringify(result.cause)).toContain('UpstreamQueryRotated')
    }
  })

  it('maps a persistent 429 to UpstreamRateLimited', async () => {
    // No Retry-After → immediate retry (no sleep); both attempts 429 →
    // RateLimitedError sentinel → UpstreamRateLimited.
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('rate limited', { status: 429 }))

    const { exit } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) => client.fetchConceptsByFeature('new', 10)),
      ),
    )
    const result = await exit

    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(JSON.stringify(result.cause)).toContain('UpstreamRateLimited')
    }
  })

  it('maps a generic upstream failure to UpstreamUnavailable', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('boom', { status: 500 }))

    const { exit } = withCapturedLogs(
      SonyClient.pipe(
        Effect.flatMap((client) => client.fetchConceptsByFeature('new', 10)),
      ),
    )
    const result = await exit

    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(JSON.stringify(result.cause)).toContain('UpstreamUnavailable')
    }
  })
})
