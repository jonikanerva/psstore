import { describe, expect, it } from 'vitest'
import { getSearchQuery } from '../lib/search.js'

describe('search query parser', () => {
  it('parses query string', () => {
    expect(getSearchQuery('?q=test')).toBe('test')
  })

  it('returns empty string when missing', () => {
    expect(getSearchQuery('')).toBe('')
  })
})
