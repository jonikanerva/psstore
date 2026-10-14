import { describe, expect, it } from 'vitest'
import {
  pdpOriginForPath,
  readPdpOrigin,
  TAB_PATHS,
} from '../modules/pdpOrigin'

describe('readPdpOrigin', () => {
  it.each([...TAB_PATHS, '/search'])('accepts %s', (origin) => {
    expect(readPdpOrigin({ pdpOrigin: origin })).toBe(origin)
  })

  it.each([
    undefined,
    null,
    'x',
    42,
    {},
    { pdpOrigin: undefined },
    { pdpOrigin: '/g/abc' },
    { pdpOrigin: '/new/' },
    { pdpOrigin: 5 },
  ])('rejects %j', (state) => {
    expect(readPdpOrigin(state)).toBeUndefined()
  })
})

describe('pdpOriginForPath', () => {
  it('maps tab and search paths', () => {
    expect(pdpOriginForPath('/discounted')).toBe('/discounted')
    expect(pdpOriginForPath('/search')).toBe('/search')
  })

  it('returns undefined for other paths', () => {
    expect(pdpOriginForPath('/g/abc')).toBeUndefined()
    expect(pdpOriginForPath('/')).toBeUndefined()
  })
})
