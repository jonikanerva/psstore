import { describe, expect, it } from 'vitest'
import { gameSchema } from '../schemas/game.js'

describe('game schema', () => {
  it('rejects invalid payload', () => {
    const result = gameSchema.safeParse({ id: '1' })
    expect(result.success).toBe(false)
  })
})
