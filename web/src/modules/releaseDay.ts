import type { Game } from '@psstore/shared'
import { DateTime } from 'luxon'
import type { GamesFeature } from './gamesQuery'

// NEW and UPCOMING split at the start of the viewer's next local day
// (docs/adr/0001-new-upcoming-day-split.md). The server sends each list a
// superset of this split, so a game near the boundary arrives in both lists.
// This split keeps it in one. `plus({ days: 1 })` is calendar math, so a
// daylight saving change does not move the boundary.
export const nextLocalDayStart = (now: DateTime): number =>
  now.startOf('day').plus({ days: 1 }).toMillis()

// NEW keeps a dated game released before the next local day: everything
// released today, also later today. UPCOMING keeps the rest, including a game
// without a date. Other views stay unchanged.
export const splitByReleaseDay = (
  feature: GamesFeature,
  games: readonly Game[],
  boundaryMs: number,
): readonly Game[] => {
  if (feature !== 'new' && feature !== 'upcoming') {
    return games
  }
  return games.filter((game) => {
    const releaseMs = Date.parse(game.date)
    const beforeBoundary = !Number.isNaN(releaseMs) && releaseMs < boundaryMs
    return feature === 'new' ? beforeBoundary : !beforeBoundary
  })
}
