export const TAB_PATHS = [
  '/new',
  '/upcoming',
  '/discounted',
  '/monthly',
  '/wishlist',
  '/purchased',
] as const

export type TabPath = (typeof TAB_PATHS)[number]

export type PdpOrigin = TabPath | '/search'

const ORIGINS: readonly string[] = [...TAB_PATHS, '/search']

const isPdpOrigin = (value: unknown): value is PdpOrigin =>
  typeof value === 'string' && ORIGINS.includes(value)

// Router history state is untrusted: a reload or a hand-edited entry can hold
// any value.
export const readPdpOrigin = (state: unknown): PdpOrigin | undefined => {
  if (typeof state !== 'object' || state === null || !('pdpOrigin' in state)) {
    return undefined
  }
  return isPdpOrigin(state.pdpOrigin) ? state.pdpOrigin : undefined
}

export const pdpOriginForPath = (pathname: string): PdpOrigin | undefined =>
  isPdpOrigin(pathname) ? pathname : undefined
