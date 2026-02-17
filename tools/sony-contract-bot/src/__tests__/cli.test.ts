import { describe, expect, it } from 'vitest'
import { usageText } from '../cli.js'

describe('cli usage', () => {
  it('does not expose auth command', () => {
    expect(usageText).not.toContain('auth')
  })
})
