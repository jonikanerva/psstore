import { describe, expect, it } from 'vitest'
import { isSameSort, sortConfigForPath } from '../modules/sortFields'

describe('sortConfigForPath', () => {
  it.each([
    ['/new', ['date', 'price', 'name'], 'date', 'desc', true],
    ['/upcoming', ['date', 'price', 'name'], 'date', 'asc', true],
    ['/discounted', ['date', 'price', 'name'], 'date', 'desc', true],
    ['/monthly', ['date', 'name'], 'date', 'desc', true],
    ['/purchased', ['name'], 'name', 'asc', false],
    ['/wishlist', ['date', 'price', 'name'], 'date', 'desc', false],
  ])(
    'offers the fields and default of %s',
    (path, fields, field, direction, serverOrdered) => {
      expect(sortConfigForPath(path)).toEqual({
        fields,
        defaultSort: { field, direction },
        serverOrdered,
      })
    },
  )

  it('has a default field that the view offers', () => {
    for (const path of [
      '/new',
      '/upcoming',
      '/discounted',
      '/monthly',
      '/purchased',
      '/wishlist',
    ]) {
      const config = sortConfigForPath(path)
      expect(config?.fields).toContain(config?.defaultSort.field)
    }
  })

  it.each(['/search', '/g/EP0001', '/', '/unknown'])(
    'offers no sort on %s',
    (path) => {
      expect(sortConfigForPath(path)).toBeUndefined()
    },
  )
})

describe('isSameSort', () => {
  it('compares field and direction', () => {
    const base = { field: 'date', direction: 'desc' } as const
    expect(isSameSort(base, { ...base })).toBe(true)
    expect(isSameSort(base, { ...base, direction: 'asc' })).toBe(false)
    expect(isSameSort(base, { ...base, field: 'name' })).toBe(false)
  })
})
