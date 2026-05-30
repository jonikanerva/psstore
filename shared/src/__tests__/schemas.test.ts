import { Either, Schema } from 'effect'
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
const decodeEither = Schema.decodeUnknownEither(gameSchema)

describe('game schema', () => {
  it('rejects invalid payload', () => {
    const result = decodeEither({ id: '1' })
    expect(Either.isLeft(result)).toBe(true)
  })

  it('defaults idKind to "product" when absent (back-compat)', () => {
    const parsed = decode(baseGame)
    expect(parsed.idKind).toBe('product')
  })

  it('round-trips an explicit concept idKind', () => {
    const parsed = decode({ ...baseGame, idKind: 'concept' })
    expect(parsed.idKind).toBe('concept')
  })
})
