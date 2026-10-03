import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveProbe } from '../contract/liveProbe.js'

const request = {
  url: 'https://example.invalid/op',
  operationName: 'metGetProductById',
  hash: 'b'.repeat(64),
  variables: { productId: 'P' },
  responseNode: 'productRetrieve',
}

const respond = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('liveProbe', () => {
  it('sends the operation name, hash, locale header and variables', async () => {
    respond({ data: { productRetrieve: { id: 'P' } } })
    await liveProbe(request)

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []
    const parsed = new URL(typeof url === 'string' ? url : '')
    expect(parsed.searchParams.get('operationName')).toBe('metGetProductById')
    expect(parsed.searchParams.get('variables')).toBe('{"productId":"P"}')
    expect(parsed.searchParams.get('extensions')).toContain('b'.repeat(64))
    const headers = new Headers(init?.headers)
    expect(headers.get('x-apollo-operation-name')).toBe('metGetProductById')
    expect(headers.get('x-psn-store-locale-override')).toBe('en-FI')
  })

  it('rejects a non-200 status', async () => {
    respond({}, 404)
    await expect(liveProbe(request)).rejects.toThrow(/HTTP 404/)
  })

  it('rejects a persisted query rotation', async () => {
    respond({ errors: [{ message: 'PersistedQueryNotFound' }] })
    await expect(liveProbe(request)).rejects.toThrow(/PersistedQueryNotFound/)
  })

  it('checks the node the request names', async () => {
    const conceptRequest = { ...request, responseNode: 'conceptRetrieve' }
    respond({ data: { conceptRetrieve: { id: '1' } } })
    await liveProbe(conceptRequest)

    respond({ data: { productRetrieve: { id: 'P' } } })
    await expect(liveProbe(conceptRequest)).rejects.toThrow(
      /no data\.conceptRetrieve/,
    )
  })

  it('rejects a response without data.productRetrieve', async () => {
    respond({ data: { productRetrieve: null } })
    await expect(liveProbe(request)).rejects.toThrow(/no data\.productRetrieve/)
  })
})
