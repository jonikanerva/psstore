import { describe, expect, it } from 'vitest'
import {
  MIN_CRITIC_COUNT,
  matchCriticScore,
  normalizeTitle,
  releaseYearOf,
  type CriticCandidate,
} from '../domain/criticMatch.js'

const candidate = (
  overrides: Partial<CriticCandidate> = {},
): CriticCandidate => ({
  name: 'Synthetic Quest',
  releaseYear: 2023,
  rating: 84,
  ratingCount: 12,
  ...overrides,
})

describe('normalizeTitle', () => {
  it('drops marks, case, punctuation, and accents', () => {
    expect(normalizeTitle('  Pokémon™: The Game®  ')).toBe('pokemon the game')
    expect(normalizeTitle("Marvel's Spider-Man")).toBe('marvels spider man')
  })

  it('strips a closed list of edition suffixes', () => {
    expect(normalizeTitle('Synthetic Quest - PS5 Edition')).toBe(
      'synthetic quest',
    )
    expect(normalizeTitle('Synthetic Quest Digital Deluxe Edition')).toBe(
      'synthetic quest',
    )
    expect(normalizeTitle('Synthetic Quest (PS4 & PS5)')).toBe(
      'synthetic quest',
    )
    expect(normalizeTitle("Synthetic Quest Collector's Edition")).toBe(
      'synthetic quest',
    )
  })

  it('keeps a remaster or a cut as a different title', () => {
    expect(normalizeTitle('Synthetic Quest Remastered')).toBe(
      'synthetic quest remastered',
    )
    expect(normalizeTitle("Synthetic Quest Director's Cut")).toBe(
      'synthetic quest directors cut',
    )
  })

  it('keeps a title that is only a suffix', () => {
    expect(normalizeTitle('Standard Edition')).toBe('standard edition')
  })
})

describe('releaseYearOf', () => {
  it('reads the UTC year', () => {
    expect(releaseYearOf('2023-12-31T23:30:00Z')).toBe(2023)
    expect(releaseYearOf('2024-01-01T00:30:00Z')).toBe(2024)
  })

  it('is null for an empty or invalid date', () => {
    expect(releaseYearOf('')).toBeNull()
    expect(releaseYearOf('not a date')).toBeNull()
  })
})

describe('matchCriticScore', () => {
  it('accepts an equal name in the same year', () => {
    expect(
      matchCriticScore('Synthetic Quest PS5 Edition', 2023, [candidate()]),
    ).toBe(84)
  })

  it('accepts a release year one apart and refuses two apart', () => {
    expect(matchCriticScore('Synthetic Quest', 2024, [candidate()])).toBe(84)
    expect(matchCriticScore('Synthetic Quest', 2025, [candidate()])).toBeNull()
  })

  it('refuses a remaster with a different name', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate({ name: 'Synthetic Quest Remastered', releaseYear: 2025 }),
      ]),
    ).toBeNull()
  })

  it('refuses an ambiguous result', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate(),
        candidate({ releaseYear: 2024, rating: 60 }),
      ]),
    ).toBeNull()
  })

  it('ignores candidates that do not match while one does', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate({ name: 'Other Game', rating: 10 }),
        candidate(),
      ]),
    ).toBe(84)
  })

  it('ignores an unrated edition entry next to a rated base entry', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate(),
        candidate({
          name: 'Synthetic Quest Deluxe Edition',
          rating: null,
          ratingCount: 0,
        }),
      ]),
    ).toBe(84)
  })

  it('ignores an edition entry with too few reviews next to a rated base entry', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate(),
        candidate({
          name: 'Synthetic Quest Complete Edition',
          releaseYear: 2024,
          rating: 94,
          ratingCount: MIN_CRITIC_COUNT - 1,
        }),
      ]),
    ).toBe(84)
  })

  it('refuses two qualified candidates with the same name', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate(),
        candidate({ name: 'Synthetic Quest Complete Edition', rating: 94 }),
      ]),
    ).toBeNull()
  })

  it('refuses when every same-name candidate is unrated', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate({ rating: null, ratingCount: 0 }),
        candidate({ name: 'Synthetic Quest Deluxe Edition', rating: null }),
      ]),
    ).toBeNull()
  })

  it('refuses a score with too few critic reviews', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate({ ratingCount: MIN_CRITIC_COUNT - 1 }),
      ]),
    ).toBeNull()
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate({ ratingCount: MIN_CRITIC_COUNT }),
      ]),
    ).toBe(84)
  })

  it('refuses a candidate without a rating or a release year', () => {
    expect(
      matchCriticScore('Synthetic Quest', 2023, [candidate({ rating: null })]),
    ).toBeNull()
    expect(
      matchCriticScore('Synthetic Quest', 2023, [
        candidate({ releaseYear: null }),
      ]),
    ).toBeNull()
  })

  it('refuses an empty candidate list and an empty title', () => {
    expect(matchCriticScore('Synthetic Quest', 2023, [])).toBeNull()
    expect(matchCriticScore('™®', 2023, [candidate({ name: '' })])).toBeNull()
  })
})
