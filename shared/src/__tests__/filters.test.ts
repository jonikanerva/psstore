import { describe, expect, it } from 'vitest'
import { filterGamesByGenre, sortByDateDesc } from '../utils/filters.js'

const games = [
  {
    id: '1',
    name: 'A',
    date: '2025-01-01T00:00:00Z',
    url: '',
    price: '',
    discountDate: '1975-01-01T00:00:00Z',
    screenshots: [],
    videos: [],
    genres: ['Action'],
    description: '',
    studio: '',
    preOrder: false,
  },
  {
    id: '2',
    name: 'B',
    date: '2024-01-01T00:00:00Z',
    url: '',
    price: '',
    discountDate: '1975-01-01T00:00:00Z',
    screenshots: [],
    videos: [],
    genres: ['RPG'],
    description: '',
    studio: '',
    preOrder: false,
  },
]

describe('filters', () => {
  it('filters by genre', () => {
    expect(filterGamesByGenre(games, 'Action')).toHaveLength(1)
  })

  it('sorts newest first', () => {
    expect(sortByDateDesc(games).map((g) => g.id)).toEqual(['1', '2'])
  })

  it('pushes invalid dates to the end', () => {
    const withInvalid = [
      ...games,
      { ...games[0], id: '3', date: '' },
      { ...games[0], id: '4', date: 'not-a-date' },
    ]
    const sorted = sortByDateDesc(withInvalid)
    expect(sorted.map((g) => g.id)).toEqual(['1', '2', '3', '4'])
  })
})
