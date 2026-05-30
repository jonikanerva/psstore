import { afterEach, describe, expect, it, vi } from 'vitest'

const envBackup = { ...process.env }

const withServer = async (
  path: string,
): Promise<{ status: number; contentType: string; body: string }> => {
  const { createApp } = await import('../app.js')
  const app = createApp()
  // Binding to an explicit host makes listen() asynchronous, so wait for the
  // `listening` event before reading the allocated address.
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1')
      listener.once('listening', () => {
        resolve(listener)
      })
      listener.once('error', reject)
    },
  )

  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test port')
    }

    const response = await fetch(`http://127.0.0.1:${String(address.port)}${path}`)
    const body = await response.text()
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}

afterEach(() => {
  vi.resetModules()
  process.env = { ...envBackup }
})

describe('app production routing', () => {
  it('does not route unknown /api paths to SPA fallback', async () => {
    process.env.NODE_ENV = 'production'

    const response = await withServer('/api/missing-route')
    expect(response.status).toBe(404)
    expect(response.contentType).toContain('application/json')
    expect(response.body).toContain('"code"')
  })
})
