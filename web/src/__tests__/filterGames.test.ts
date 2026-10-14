import { describe, expect, it } from 'vitest'
import type { Game } from '@psstore/api-client'
import { filterGamesByName } from '../modules/filterGames'

const games: Game[] = [
  {
    id: '1',
    name: 'A',
    date: '2025-01-01T00:00:00Z',
    url: '',
    price: '',
    originalPrice: '',
    discountText: '',
    discountDate: '1975-01-01T00:00:00Z',
    screenshots: [],
    videos: [],
    genres: ['Action'],
    description: '',
    studio: '',
    preOrder: false,
    plusUpsellText: null,
    plusOffer: null,
    idKind: 'product',
  },
  {
    id: '2',
    name: 'B',
    date: '2024-01-01T00:00:00Z',
    url: '',
    price: '',
    originalPrice: '',
    discountText: '',
    discountDate: '1975-01-01T00:00:00Z',
    screenshots: [],
    videos: [],
    genres: ['RPG'],
    description: '',
    studio: '',
    preOrder: false,
    plusUpsellText: null,
    plusOffer: null,
    idKind: 'product',
  },
]

describe('filterGamesByName', () => {
  const first = games[0]
  const second = games[1]
  if (!first || !second) {
    throw new Error('fixture missing games')
  }
  const named: Game[] = [
    { ...first, id: '1', name: 'abc xyz' },
    { ...second, id: '2', name: '1234567x' },
    { ...first, id: '3', name: 'Hollow Knight: Silksong' },
  ]

  it('returns the full list for an empty query', () => {
    expect(filterGamesByName(named, '').map((g) => g.id)).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('matches case-insensitively', () => {
    expect(filterGamesByName(named, 'ABC').map((g) => g.id)).toEqual(['1'])
  })

  it('matches a substring anywhere in the name', () => {
    expect(filterGamesByName(named, 'x').map((g) => g.id)).toEqual(['1', '2'])
  })

  it('treats a whitespace-only query as empty', () => {
    expect(filterGamesByName(named, '   ').map((g) => g.id)).toEqual([
      '1',
      '2',
      '3',
    ])
  })
})
