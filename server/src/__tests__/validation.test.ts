import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  gameIdParamSchema,
  paginationQuerySchema,
} from '../validation/schemas.js'

const decodeId = Schema.decodeUnknownResult(gameIdParamSchema)
const decodePagination = Schema.decodeUnknownResult(paginationQuerySchema)
const decodePaginationSync = Schema.decodeUnknownSync(paginationQuerySchema)

describe('gameIdParamSchema', () => {
  it('rejects missing id', () => {
    expect(Result.isFailure(decodeId({}))).toBe(true)
  })

  it('rejects an id that is blank after trimming', () => {
    expect(Result.isFailure(decodeId({ id: '   ' }))).toBe(true)
  })

  it('accepts valid id', () => {
    expect(Result.isSuccess(decodeId({ id: 'EP0001-PPSA01234_00-TEST' }))).toBe(
      true,
    )
  })
})

describe('paginationQuerySchema', () => {
  it('uses defaults for empty query', () => {
    expect(decodePaginationSync({})).toEqual({ offset: 0, size: 60 })
  })

  it('parses string values', () => {
    expect(decodePaginationSync({ offset: '60', size: '30' })).toEqual({
      offset: 60,
      size: 30,
    })
  })

  it('rejects size above max 120', () => {
    expect(Result.isFailure(decodePagination({ size: '500' }))).toBe(true)
  })

  it('rejects negative offset', () => {
    expect(Result.isFailure(decodePagination({ offset: '-1' }))).toBe(true)
  })

  it('rejects a non-numeric size and a non-integer offset', () => {
    expect(Result.isFailure(decodePagination({ size: 'abc' }))).toBe(true)
    expect(Result.isFailure(decodePagination({ offset: '1.5' }))).toBe(true)
  })

  it('accepts the size bounds 1 and 120 and rejects 0', () => {
    expect(decodePaginationSync({ size: '1' }).size).toBe(1)
    expect(decodePaginationSync({ size: '120' }).size).toBe(120)
    expect(Result.isFailure(decodePagination({ size: '0' }))).toBe(true)
  })
})
