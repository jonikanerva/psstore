import { describe, expect, it } from 'vitest'
import { parseArgv, usageText } from '../cli.js'

describe('cli usage', () => {
  it('does not expose auth command', () => {
    expect(usageText).not.toContain('auth')
  })
})

describe('parseArgv', () => {
  it('returns the first token as the command', () => {
    const result = parseArgv(['validate'])

    expect(result.command).toBe('validate')
    expect(result.args.size).toBe(0)
  })

  it('strips a leading -- token (pnpm run sony -- <cmd> shape)', () => {
    const result = parseArgv(['--', 'validate'])

    expect(result.command).toBe('validate')
    expect(result.args.size).toBe(0)
  })

  it('keeps flags after the command when a leading -- is stripped', () => {
    const result = parseArgv(['--', 'diff', '--ci'])

    expect(result.command).toBe('diff')
    expect(result.args.has('--ci')).toBe(true)
  })

  it('returns command undefined when argv is empty', () => {
    const result = parseArgv([])

    expect(result.command).toBeUndefined()
    expect(result.args.size).toBe(0)
  })

  it('only strips a single leading -- token', () => {
    const result = parseArgv(['--', '--', 'validate'])

    expect(result.command).toBe('--')
    expect(result.args.has('validate')).toBe(true)
  })
})
