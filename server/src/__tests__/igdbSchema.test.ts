import { Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { parseGamesResponse, parseTokenResponse } from '../igdb/igdbSchema.js'
import golden from './fixtures/igdbGames.golden.json' with { type: 'json' }

describe('parseGamesResponse', () => {
  it('decodes the golden fixture', () => {
    const candidates = parseGamesResponse(golden)
    expect(candidates).toEqual([
      {
        name: 'Synthetic Quest',
        releaseYear: 2023,
        rating: 84,
        ratingCount: 12,
      },
      {
        name: 'Synthetic Quest: Remastered',
        releaseYear: 2025,
        rating: 80,
        ratingCount: 5,
      },
      {
        name: 'Synthetic Unrated',
        releaseYear: 2023,
        rating: null,
        ratingCount: 0,
      },
      // Malformed values are dropped; the candidate stays without a score.
      {
        name: 'Synthetic Malformed',
        releaseYear: null,
        rating: null,
        ratingCount: 0,
      },
    ])
  })

  it('drops an out-of-range rating', () => {
    const result = parseGamesResponse([
      { name: 'A', aggregated_rating: 120, aggregated_rating_count: 9 },
      { name: 'B', aggregated_rating: -1, aggregated_rating_count: 9 },
    ])
    expect(result?.map((item) => item.rating)).toEqual([null, null])
  })

  it('is null when the body is not an array', () => {
    expect(parseGamesResponse({ message: 'nope' })).toBeNull()
    expect(parseGamesResponse(null)).toBeNull()
  })
})

describe('parseTokenResponse', () => {
  it('keeps the token redacted', () => {
    const token = parseTokenResponse({
      access_token: 'synthetic-token',
      expires_in: 3600,
      token_type: 'bearer',
    })
    expect(token?.expiresInSeconds).toBe(3600)
    expect(JSON.stringify(token)).not.toContain('synthetic-token')
    expect(token === null ? '' : Redacted.value(token.accessToken)).toBe(
      'synthetic-token',
    )
  })

  it('is null without a usable token or lifetime', () => {
    expect(parseTokenResponse({ access_token: '', expires_in: 10 })).toBeNull()
    expect(parseTokenResponse({ access_token: 'x' })).toBeNull()
    expect(parseTokenResponse({ access_token: 'x', expires_in: 0 })).toBeNull()
  })
})
