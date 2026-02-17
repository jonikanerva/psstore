import { describe, expect, it } from 'vitest'
import { gameIdParamSchema } from '../validation/schemas.js'

describe('gameIdParamSchema', () => {
  it('rejects missing id', () => {
    const result = gameIdParamSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts valid id', () => {
    const result = gameIdParamSchema.safeParse({ id: 'EP0001-PPSA01234_00-TEST' })
    expect(result.success).toBe(true)
  })
})
