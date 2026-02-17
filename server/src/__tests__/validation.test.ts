import { describe, expect, it } from 'vitest'
import { gameIdParamSchema, paginationQuerySchema } from '../validation/schemas.js'

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

describe('paginationQuerySchema', () => {
  it('uses defaults for empty query', () => {
    const result = paginationQuerySchema.parse({})
    expect(result).toEqual({ offset: 0, size: 60 })
  })

  it('parses string values', () => {
    const result = paginationQuerySchema.parse({ offset: '60', size: '30' })
    expect(result).toEqual({ offset: 60, size: 30 })
  })

  it('rejects size above max 120', () => {
    expect(paginationQuerySchema.safeParse({ size: '500' }).success).toBe(false)
  })

  it('rejects negative offset', () => {
    expect(paginationQuerySchema.safeParse({ offset: '-1' }).success).toBe(false)
  })
})
