import { describe, expect, it } from 'vitest'
import { sortFieldsForPath } from '../modules/sortFields'

describe('sortFieldsForPath', () => {
  it.each([
    ['/new', ['date', 'price', 'name']],
    ['/discounted', ['date', 'price', 'name']],
    ['/upcoming', ['date', 'name']],
    ['/monthly', ['date', 'name']],
    ['/purchased', ['name']],
  ])('offers the agreed fields on %s', (path, fields) => {
    expect(sortFieldsForPath(path)).toEqual(fields)
  })

  it.each(['/search', '/g/EP0001', '/', '/unknown'])(
    'offers no sort on %s',
    (path) => {
      expect(sortFieldsForPath(path)).toEqual([])
    },
  )
})
