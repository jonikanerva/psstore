import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { gameSchema } from '../schemas/game.js'

const baseGame = {
  id: 'EP0001-PPSA01234_00-TESTGAME00000001',
  name: 'Test Game',
  date: '2025-06-15T00:00:00Z',
  url: '',
  price: '69,99 €',
  originalPrice: '',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
}

const decode = Schema.decodeUnknownSync(gameSchema)
const decodeResult = Schema.decodeUnknownResult(gameSchema)
const encode = Schema.encodeSync(gameSchema)

describe('game schema', () => {
  it('rejects invalid payload', () => {
    const result = decodeResult({ id: '1' })
    expect(Result.isFailure(result)).toBe(true)
  })

  it('defaults idKind to "product" when absent (back-compat)', () => {
    const parsed = decode(baseGame)
    expect(parsed.idKind).toBe('product')
  })

  it('defaults idKind to "product" when explicitly undefined', () => {
    const parsed = decode({ ...baseGame, idKind: undefined })
    expect(parsed.idKind).toBe('product')
  })

  it('rejects an unknown idKind', () => {
    expect(
      Result.isFailure(decodeResult({ ...baseGame, idKind: 'bundle' })),
    ).toBe(true)
  })

  it('encodes the defaulted idKind into the wire value', () => {
    expect(encode(decode(baseGame)).idKind).toBe('product')
  })

  it('round-trips an explicit concept idKind', () => {
    const parsed = decode({ ...baseGame, idKind: 'concept' })
    expect(parsed.idKind).toBe('concept')
  })
})
