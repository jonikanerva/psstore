import { describe, expect, it } from 'vitest'
import { extractProductDetail, extractReleaseDateFromProductResponse } from '../sony/sonyClient.js'

describe('extractReleaseDateFromProductResponse', () => {
  it('extracts releaseDate from productRetrieve payload', () => {
    const result = extractReleaseDateFromProductResponse({
      data: {
        productRetrieve: {
          id: 'UP0102-PPSA02530_00-PRAGMATA00000000',
          releaseDate: '2026-04-23T21:00:00Z',
        },
      },
    })

    expect(result).toBe('2026-04-23T21:00:00Z')
  })
})

describe('extractProductDetail', () => {
  it('extracts releaseDate, genres, and description', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'UP0102-PPSA02530_00-PRAGMATA00000000',
          releaseDate: '2026-04-23T21:00:00Z',
          genres: ['Action', 'Adventure'],
          longDescription: '<p>An amazing game</p>',
        },
      },
    })

    expect(result.releaseDate).toBe('2026-04-23T21:00:00Z')
    expect(result.genres).toEqual(['Action', 'Adventure'])
    expect(result.description).toBe('<p>An amazing game</p>')
  })

  it('returns empty defaults when fields are missing', () => {
    const result = extractProductDetail({
      data: { productRetrieve: { id: 'test' } },
    })

    expect(result.releaseDate).toBeUndefined()
    expect(result.genres).toEqual([])
    expect(result.description).toBe('')
  })

  it('extracts publisherName from product detail', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'UP4139-PPSA27597_00-STELLARDELUXEPS5',
          releaseDate: '2025-11-11T00:00:00Z',
          genres: ['Strategy'],
          longDescription: '<p>Grand strategy</p>',
          publisherName: 'PARADOX GAMES INC',
        },
      },
    })

    expect(result.publisherName).toBe('PARADOX GAMES INC')
  })

  it('returns undefined publisherName when missing', () => {
    const result = extractProductDetail({
      data: { productRetrieve: { id: 'test' } },
    })

    expect(result.publisherName).toBeUndefined()
  })

  it('falls back to description when longDescription is missing', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'test',
          description: 'Short desc',
        },
      },
    })

    expect(result.description).toBe('Short desc')
  })
})

