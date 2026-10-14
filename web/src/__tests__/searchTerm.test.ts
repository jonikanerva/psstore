import { describe, expect, it } from 'vitest'
import { shouldDehydrateQuery } from '../modules/persistence'
import {
  normalizeSearchTerm,
  parseSearch,
  readSearchTerm,
  stringifySearch,
} from '../modules/searchTerm'

describe('normalizeSearchTerm', () => {
  it('trims and caps the term at 100 characters', () => {
    expect(normalizeSearchTerm('  elden  ')).toBe('elden')
    expect(normalizeSearchTerm('a'.repeat(120))).toHaveLength(100)
    expect(normalizeSearchTerm('   ')).toBe('')
  })
})

describe('readSearchTerm', () => {
  it('reads a string q and ignores anything else', () => {
    expect(readSearchTerm({ q: ' god of war ' })).toBe('god of war')
    expect(readSearchTerm({})).toBe('')
    expect(readSearchTerm({ q: 2077 })).toBe('')
    expect(readSearchTerm(null)).toBe('')
    expect(readSearchTerm('q=x')).toBe('')
  })
})

describe('search param codec', () => {
  it.each(['2077', 'true', 'null', 'a & b', '<b>"x"</b>', '{"a":1}', 'päivä'])(
    'round-trips %s as the same string',
    (term) => {
      expect(parseSearch(stringifySearch({ q: term }))).toEqual({ q: term })
    },
  )

  it('writes nothing for an empty record', () => {
    expect(stringifySearch({})).toBe('')
  })
})

describe('shouldDehydrateQuery', () => {
  it('persists only the anonymous games and game caches', () => {
    expect(shouldDehydrateQuery({ queryKey: ['games', 'new'] })).toBe(true)
    expect(shouldDehydrateQuery({ queryKey: ['game', 'id'] })).toBe(true)
  })

  it('never persists a search query', () => {
    expect(shouldDehydrateQuery({ queryKey: ['search', 'elden'] })).toBe(false)
    expect(shouldDehydrateQuery({ queryKey: ['search'] })).toBe(false)
  })
})
