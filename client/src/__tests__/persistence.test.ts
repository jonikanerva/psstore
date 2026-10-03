import { QueryClient, dehydrate } from '@tanstack/react-query'
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
    expect(persists(['wishlist'])).toBe(false)
    expect(persists(['search', 'zelda'])).toBe(false)
    expect(persists([])).toBe(false)
  })
})

describe('a prefetched signed-in list', () => {
  it('never dehydrates, even with data', () => {
    const client = new QueryClient()
    const list = { games: [], totalCount: 0, nextOffset: null }
    client.setQueryData(['wishlist'], list)
    client.setQueryData(['purchased'], list)
    client.setQueryData(['games', 'upcoming'], {
      pages: [list],
      pageParams: [0],
    })
    const keys = dehydrate(client, { shouldDehydrateQuery }).queries.map(
      (query) => query.queryKey,
    )
    expect(keys).toEqual([['games', 'upcoming']])
  })
})

describe('a fully loaded games query', () => {
  it('dehydrates as one entry with every page', () => {
    const client = new QueryClient()
    client.setQueryData(['games', 'new'], {
      pages: [
        { games: [], totalCount: 2, nextOffset: 60 },
        { games: [], totalCount: 2, nextOffset: null },
      ],
      pageParams: [0, 60],
    })
    const state = dehydrate(client, { shouldDehydrateQuery })
    expect(state.queries).toHaveLength(1)
    expect(state.queries[0]?.queryKey).toEqual(['games', 'new'])
  })
})
