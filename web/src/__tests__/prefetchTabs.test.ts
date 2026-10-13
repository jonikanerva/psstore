import { describe, expect, it } from 'vitest'
import {
  isSignedInTab,
  nextTab,
  PREFETCH_ORDER,
  type PrefetchTab,
} from '../modules/prefetchTabs'

const without =
  (...held: readonly PrefetchTab[]) =>
  (tab: PrefetchTab) =>
    held.includes(tab)

describe('nextTab', () => {
  it('follows the order: upcoming, discounted, monthly, wishlist, purchased', () => {
    expect(PREFETCH_ORDER).toEqual([
      'upcoming',
      'discounted',
      'monthly',
      'wishlist',
      'purchased',
    ])
    const held: PrefetchTab[] = []
    const seen: PrefetchTab[] = []
    for (let tab = nextTab(PREFETCH_ORDER, without(...held), 'unknown'); tab;) {
      seen.push(tab)
      held.push(tab)
      tab = nextTab(PREFETCH_ORDER, without(...held), 'unknown')
    }
    expect(seen).toEqual([...PREFETCH_ORDER])
  })

  it('skips a tab that has data', () => {
    expect(
      nextTab(PREFETCH_ORDER, without('upcoming', 'monthly'), 'unknown'),
    ).toBe('discounted')
    expect(
      nextTab(
        PREFETCH_ORDER,
        without('upcoming', 'discounted', 'monthly'),
        'unknown',
      ),
    ).toBe('wishlist')
  })

  it('returns null when every tab has data', () => {
    expect(nextTab(PREFETCH_ORDER, () => true, 'unknown')).toBeNull()
  })

  it('skips the signed-in tabs when access is denied', () => {
    expect(
      nextTab(
        PREFETCH_ORDER,
        without('upcoming', 'discounted', 'monthly'),
        'denied',
      ),
    ).toBeNull()
    expect(nextTab(PREFETCH_ORDER, without(), 'denied')).toBe('upcoming')
  })

  it('treats only WISHLIST and PURCHASED as signed-in', () => {
    expect(PREFETCH_ORDER.filter(isSignedInTab)).toEqual([
      'wishlist',
      'purchased',
    ])
  })
})
