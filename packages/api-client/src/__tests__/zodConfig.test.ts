import { describe, expect, it } from 'vitest'
import { config } from 'zod'

// The browser journeys (`e2e/`) prove that the page causes no CSP violation.
// This test pins the cause of the one that Zod caused without the setting.
describe('the Zod configuration of the facade', () => {
  it('turns off the eval compilation of Zod', async () => {
    await import('../index')
    expect(config().jitless).toBe(true)
  })
})
