import { describe, expect, it } from 'vitest'
import type { Game } from '../types/game.js'
import { NATURAL_DIRECTION, parsePrice, sortGames } from '../utils/sortGames.js'

const game = (id: string, patch: Partial<Game> = {}): Game => ({
  id,
  name: id,
  date: '',
  url: '',
  price: '',
  originalPrice: '',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind: 'product',
  ...patch,
})

const ids = (games: readonly Game[]): string[] => games.map((g) => g.id)

describe('parsePrice', () => {
  it.each([
    ['12,99 €', 12.99],
    ['€44,95', 44.95],
    ['€7,95', 7.95],
    ['12 €', 12],
    ['0,00 €', 0],
    ['Free', 0],
    ['FREE', 0],
    [' Free ', 0],
    ['12,9 €', 12.9],
    ['12,99 €', 12.99],
    ['€ 12,99', 12.99],
    ['1 234,50 €', 1234.5],
    ['1 234,50 €', 1234.5],
    ['1.234,50 €', 1234.5],
    ['€1.234', 1234],
    [' 12,99 €', 12.99],
  ])('parses %j', (text, value) => {
    expect(parsePrice(text)).toBe(value)
  })

  it.each([
    '',
    'Included',
    'Game Trial',
    'Ei saatavilla',
    'Free to Play',
    '12.99',
    '1,234',
    '12,999 €',
    '€ €',
    '$12,99',
    '12,99 € extra',
    '-',
  ])('treats %j as missing', (text) => {
    expect(parsePrice(text)).toBeNull()
  })
})

describe('sortGames', () => {
  it('returns a copy and leaves the input untouched', () => {
    const input = [
      game('b', { date: '2025-01-02T00:00:00Z' }),
      game('a', { date: '2025-01-01T00:00:00Z' }),
    ]
    const out = sortGames(input, { field: 'date', direction: 'asc' })
    expect(out).not.toBe(input)
    expect(ids(input)).toEqual(['b', 'a'])
    expect(ids(out)).toEqual(['a', 'b'])
  })

  it('sorts by date both ways', () => {
    const input = [
      game('mid', { date: '2025-02-01T00:00:00Z' }),
      game('old', { date: '2024-02-01T00:00:00Z' }),
      game('new', { date: '2026-02-01T00:00:00Z' }),
    ]
    expect(ids(sortGames(input, { field: 'date', direction: 'asc' }))).toEqual([
      'old',
      'mid',
      'new',
    ])
    expect(ids(sortGames(input, { field: 'date', direction: 'desc' }))).toEqual(
      ['new', 'mid', 'old'],
    )
  })

  it('sorts a game with an empty or invalid date last in both directions', () => {
    const input = [
      game('empty'),
      game('b', { date: '2025-02-01T00:00:00Z' }),
      game('bad', { date: 'not a date' }),
      game('a', { date: '2025-01-01T00:00:00Z' }),
    ]
    expect(ids(sortGames(input, { field: 'date', direction: 'asc' }))).toEqual([
      'a',
      'b',
      'empty',
      'bad',
    ])
    expect(ids(sortGames(input, { field: 'date', direction: 'desc' }))).toEqual(
      ['b', 'a', 'empty', 'bad'],
    )
  })

  it('sorts by price and puts non-prices last in both directions', () => {
    const input = [
      game('free', { price: 'Included' }),
      game('big', { price: '1 234,50 €' }),
      game('small', { price: '€4,95' }),
      game('none'),
      game('mid', { price: '44,95 €' }),
    ]
    expect(ids(sortGames(input, { field: 'price', direction: 'asc' }))).toEqual(
      ['small', 'mid', 'big', 'free', 'none'],
    )
    expect(
      ids(sortGames(input, { field: 'price', direction: 'desc' })),
    ).toEqual(['big', 'mid', 'small', 'free', 'none'])
  })

  it('sorts a Free game as 0 € and keeps unknown prices last', () => {
    // Owner request 2026-10-05: "Free" equals 0 €. Unknown prices stay last
    // in both directions.
    const input = [
      game('included', { price: 'Included' }),
      game('free', { price: 'Free' }),
      game('big', { price: '59,95 €' }),
      game('none'),
      game('zero', { price: '0,00 €' }),
      game('small', { price: '€4,95' }),
    ]
    expect(ids(sortGames(input, { field: 'price', direction: 'asc' }))).toEqual(
      ['free', 'zero', 'small', 'big', 'included', 'none'],
    )
    expect(
      ids(sortGames(input, { field: 'price', direction: 'desc' })),
    ).toEqual(['big', 'small', 'free', 'zero', 'included', 'none'])
  })

  it('sorts names case-insensitively with numeric order', () => {
    const input = [
      game('3', { name: 'Game 10' }),
      game('1', { name: 'game 2' }),
      game('2', { name: 'Árvo' }),
      game('4', { name: 'Zed' }),
    ]
    expect(ids(sortGames(input, { field: 'name', direction: 'asc' }))).toEqual([
      '2',
      '1',
      '3',
      '4',
    ])
    expect(ids(sortGames(input, { field: 'name', direction: 'desc' }))).toEqual(
      ['4', '3', '1', '2'],
    )
  })

  it('sorts an empty name last in both directions', () => {
    const input = [
      game('blank', { name: '  ' }),
      game('b', { name: 'B' }),
      game('a', { name: 'A' }),
    ]
    expect(ids(sortGames(input, { field: 'name', direction: 'asc' }))).toEqual([
      'a',
      'b',
      'blank',
    ])
    expect(ids(sortGames(input, { field: 'name', direction: 'desc' }))).toEqual(
      ['b', 'a', 'blank'],
    )
  })

  it('keeps input order for equal keys in both directions', () => {
    const input = [
      game('x1', { name: 'Same' }),
      game('x2', { name: 'same' }),
      game('x3', { name: 'SAME' }),
    ]
    expect(ids(sortGames(input, { field: 'name', direction: 'asc' }))).toEqual([
      'x1',
      'x2',
      'x3',
    ])
    expect(ids(sortGames(input, { field: 'name', direction: 'desc' }))).toEqual(
      ['x1', 'x2', 'x3'],
    )
  })

  it('keeps input order among missing keys', () => {
    const input = [game('m1'), game('m2'), game('m3')]
    expect(
      ids(sortGames(input, { field: 'price', direction: 'desc' })),
    ).toEqual(['m1', 'm2', 'm3'])
  })

  it('returns an empty list for an empty input', () => {
    expect(sortGames([], { field: 'name', direction: 'asc' })).toEqual([])
  })
})

describe('NATURAL_DIRECTION', () => {
  it('starts date newest first, price and name ascending', () => {
    expect(NATURAL_DIRECTION).toEqual({
      date: 'desc',
      price: 'asc',
      name: 'asc',
    })
  })
})
