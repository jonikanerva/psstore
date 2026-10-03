export const PREFETCH_ORDER = [
  'upcoming',
  'discounted',
  'monthly',
  'wishlist',
  'purchased',
] as const

export type PrefetchTab = (typeof PREFETCH_ORDER)[number]

// `denied` after Sony rejected the sign-in cookie, or after a sign-out.
export type SignedInAccess = 'unknown' | 'denied'

const SIGNED_IN_TABS: ReadonlySet<PrefetchTab> = new Set([
  'wishlist',
  'purchased',
])

export const isSignedInTab = (tab: PrefetchTab): boolean =>
  SIGNED_IN_TABS.has(tab)

export const nextTab = (
  order: readonly PrefetchTab[],
  hasData: (tab: PrefetchTab) => boolean,
  access: SignedInAccess,
): PrefetchTab | null =>
  order.find(
    (tab) => !hasData(tab) && !(access === 'denied' && isSignedInTab(tab)),
  ) ?? null
