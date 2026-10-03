import { describe, expect, it } from 'vitest'
import { shouldPersistQuery } from '../modules/persistence'

describe('shouldPersistQuery', () => {
  it('persists only the anonymous games and game keys', () => {
    expect(shouldPersistQuery(['games', 'new'])).toBe(true)
    expect(shouldPersistQuery(['game', 'EP0001'])).toBe(true)
  })

  it('never persists the signed-in library or an unknown key', () => {
    expect(shouldPersistQuery(['purchased'])).toBe(false)
    expect(shouldPersistQuery(['search', 'zelda'])).toBe(false)
    expect(shouldPersistQuery([])).toBe(false)
  })
})
