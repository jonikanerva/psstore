import { describe, expect, it } from 'vitest'
import type { Game } from '../types/game.js'
import { sortByDateDesc } from '../utils/filters.js'

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
  },
]

describe('filters', () => {
  it('sorts newest first', () => {
    expect(sortByDateDesc(games).map((g) => g.id)).toEqual(['1', '2'])
  })

  it('pushes invalid dates to the end', () => {
    const first = games[0]
    if (!first) {
      throw new Error('fixture missing first game')
    }
    const withInvalid: Game[] = [
      ...games,
      { ...first, id: '3', date: '' },
      { ...first, id: '4', date: 'not-a-date' },
    ]
    const sorted = sortByDateDesc(withInvalid)
    expect(sorted.map((g) => g.id)).toEqual(['1', '2', '3', '4'])
  })
})
