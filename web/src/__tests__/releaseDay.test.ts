import type { Game } from '@psstore/shared'
import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { nextLocalDayStart, splitByReleaseDay } from '../modules/releaseDay'

const game = (name: string, date: string): Game => ({
  id: name,
  name,
  date,
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
})

// Each case gives the zone explicitly, so no result depends on the zone of
// the test machine.
const boundary = (localIso: string, zone: string): string =>
  new Date(
    nextLocalDayStart(DateTime.fromISO(localIso, { zone })),
  ).toISOString()

describe('nextLocalDayStart', () => {
  it('is the next local midnight in Helsinki', () => {
    expect(boundary('2026-10-05T23:30:00', 'Europe/Helsinki')).toBe(
      '2026-10-05T21:00:00.000Z',
    )
    expect(boundary('2026-10-05T00:00:00', 'Europe/Helsinki')).toBe(
      '2026-10-05T21:00:00.000Z',
    )
  })

  it('follows a daylight saving change on the current day', () => {
    // Helsinki leaves summer time on 2026-10-25 and starts it on 2026-03-29.
    expect(boundary('2026-10-25T12:00:00', 'Europe/Helsinki')).toBe(
      '2026-10-25T22:00:00.000Z',
    )
    expect(boundary('2026-03-29T01:00:00', 'Europe/Helsinki')).toBe(
      '2026-03-29T21:00:00.000Z',
    )
  })

  it('uses the viewer zone, far east and far west of UTC', () => {
    expect(boundary('2026-10-05T10:00:00', 'Pacific/Kiritimati')).toBe(
      '2026-10-05T10:00:00.000Z',
    )
    expect(boundary('2026-10-05T10:00:00', 'America/Los_Angeles')).toBe(
      '2026-10-06T07:00:00.000Z',
    )
  })
})

describe('splitByReleaseDay', () => {
  const BOUNDARY = Date.parse('2026-10-05T21:00:00Z')
  const games = [
    game('released', '2026-09-28T08:00:00Z'),
    game('later-today', '2026-10-05T20:59:59Z'),
    game('at-midnight', '2026-10-05T21:00:00Z'),
    game('next-week', '2026-10-12T21:00:00Z'),
    game('no-date', ''),
    game('bad-date', 'not a date'),
  ]
  const names = (feature: 'new' | 'upcoming' | 'discounted') =>
    splitByReleaseDay(feature, games, BOUNDARY).map((item) => item.name)

  it('keeps in NEW every dated game before the next local day', () => {
    expect(names('new')).toEqual(['released', 'later-today'])
  })

  it('keeps in UPCOMING the next local day onwards and undated games', () => {
    expect(names('upcoming')).toEqual([
      'at-midnight',
      'next-week',
      'no-date',
      'bad-date',
    ])
  })

  it('puts each game in exactly one of the two lists', () => {
    const both = [...names('new'), ...names('upcoming')].sort()
    expect(both).toEqual(games.map((item) => item.name).sort())
  })

  it('leaves other views unchanged', () => {
    expect(names('discounted')).toEqual(games.map((item) => item.name))
  })
})
