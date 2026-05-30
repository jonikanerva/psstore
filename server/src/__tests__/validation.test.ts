import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  gameIdParamSchema,
  paginationQuerySchema,
} from '../validation/schemas.js'

const decodeId = Schema.decodeUnknownEither(gameIdParamSchema)
const decodePagination = Schema.decodeUnknownEither(paginationQuerySchema)
const decodePaginationSync = Schema.decodeUnknownSync(paginationQuerySchema)

describe('gameIdParamSchema', () => {
  it('rejects missing id', () => {
    expect(Either.isLeft(decodeId({}))).toBe(true)
  })

  it('accepts valid id', () => {
    expect(Either.isRight(decodeId({ id: 'EP0001-PPSA01234_00-TEST' }))).toBe(
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
    expect(Either.isLeft(decodePagination({ size: '500' }))).toBe(true)
  })

  it('rejects negative offset', () => {
    expect(Either.isLeft(decodePagination({ offset: '-1' }))).toBe(true)
  })
})
