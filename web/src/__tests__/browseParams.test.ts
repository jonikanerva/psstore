import { QueryClient } from '@tanstack/react-query'
import type { Game, PageResult } from '@psstore/shared'
import { describe, expect, it } from 'vitest'
import { readBrowseParams } from '../modules/browseParams'
import { findCachedGame } from '../modules/cachedGame'
import { viewKeyFor } from '../modules/focusReturn'

describe('readBrowseParams', () => {
  it('reads a valid genre key and order', () => {
    expect(
      readBrowseParams({ genre: 'MUSIC/RHYTHM', order: 'name-desc' }),
    ).toEqual({ genre: 'MUSIC/RHYTHM', order: 'name-desc' })
  })

  it.each([
    [{}],
    [null],
    ['genre=ACTION'],
    [{ genre: 'action', order: 'price' }],
    [{ genre: 7, order: ['newest'] }],
    [{ genre: 'A'.repeat(65), order: 'sales30' }],
  ])('reads %j as an empty selection', (search) => {
    expect(readBrowseParams(search)).toEqual({
      genre: undefined,
      order: undefined,
    })
  })
})

describe('viewKeyFor', () => {
  it('makes one BROWSE view per genre and order', () => {
    expect(viewKeyFor('/browse', { genre: 'ACTION', order: 'newest' })).toBe(
      '/browse?ACTION&newest',
    )
    expect(
      viewKeyFor('/browse', { genre: 'ACTION', order: 'oldest' }),
    ).not.toBe(viewKeyFor('/browse', { genre: 'ACTION', order: 'newest' }))
    expect(viewKeyFor('/browse', {})).toBe('/browse?&')
  })

  it('keeps the search and tab keys', () => {
    expect(viewKeyFor('/search', { q: ' elden ' })).toBe('/search?elden')
    expect(viewKeyFor('/new', { genre: 'ACTION' })).toBe('/new')
  })
})

describe('findCachedGame', () => {
  it('finds a game that a BROWSE page loaded', () => {
    const client = new QueryClient()
    const game: Game = {
      id: 'EP0001-PPSA00001_00-BROWSE0000000001',
      name: 'A',
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
    }
    client.setQueryData<{ pages: PageResult[]; pageParams: number[] }>(
      ['browse', 'ACTION', 'newest'],
      {
        pages: [
          {
            games: [game],
            totalCount: 1,
            nextOffset: null,
          },
        ],
        pageParams: [0],
      },
    )
    expect(findCachedGame(client, game.id)?.name).toBe('A')
  })
})
