import { describe, expect, it } from 'vitest'
import { isSameSort, sortConfigForPath } from '../modules/sortFields'

describe('sortConfigForPath', () => {
  it.each([
    ['/new', ['date', 'price', 'name'], 'date', 'desc'],
    ['/upcoming', ['date', 'name'], 'date', 'asc'],
    ['/discounted', ['date', 'price', 'name'], 'date', 'desc'],
    ['/monthly', ['date', 'name'], 'date', 'desc'],
    ['/purchased', ['name'], 'name', 'asc'],
    ['/wishlist', ['date', 'price', 'name'], 'date', 'desc'],
  ])(
    'offers the fields and default of %s',
    (path, fields, field, direction) => {
      expect(sortConfigForPath(path)).toEqual({
        fields,
        defaultSort: { field, direction },
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
