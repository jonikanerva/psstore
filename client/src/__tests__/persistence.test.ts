import { describe, expect, it } from 'vitest'
import { shouldDehydrateQuery } from '../modules/persistence'

const persists = (queryKey: readonly unknown[]): boolean =>
  shouldDehydrateQuery({ queryKey })

describe('shouldDehydrateQuery', () => {
  it('persists only the anonymous games and game keys', () => {
    expect(persists(['games', 'new'])).toBe(true)
    expect(persists(['game', 'EP0001'])).toBe(true)
  })

  it('never persists the signed-in library or an unknown key', () => {
    expect(persists(['purchased'])).toBe(false)
    expect(persists(['search', 'zelda'])).toBe(false)
    expect(persists([])).toBe(false)
  })
})
