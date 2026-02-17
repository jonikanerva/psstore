import { describe, expect, it } from 'vitest'
import { extractReleaseDateFromProductResponse } from '../sony/sonyClient.js'

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

