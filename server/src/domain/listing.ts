import { gamesSchema, type Game, type PageResult } from '@psstore/shared'
import { Schema } from 'effect'
import { conceptToGame } from '../sony/mapper.js'
import type { Concept } from '../sony/types.js'

// Pure domain core: sorting, pagination, scope filtering, and concept→game
// mapping. No I/O (no fetch, cache, clock-as-service) is imported here — those
// live in the infrastructure/service layer. `Date.now()` / `Date.parse` are the
// only ambient reads and are confined to the date predicates below.

const decodeGames = Schema.decodeUnknownSync(gamesSchema)

const PRODUCT_ID_PATTERN = /^[A-Z]{2}\d{4}-[A-Z]{4}\d{5}_00-/

export const isValidProductId = (id: string): boolean =>
  PRODUCT_ID_PATTERN.test(id)

export type SortOrder = 'date-desc' | 'date-asc'

// Unparseable / missing dates sort last (most distant in the requested
// direction) rather than producing NaN comparisons, which would make the sort
// implementation-defined.
const DATE_DESC_SENTINEL = Number.NEGATIVE_INFINITY
const DATE_ASC_SENTINEL = Number.POSITIVE_INFINITY

/**
 * Sort enriched games by per-product release date, falling back to the upstream
 * order (the server's `conceptReleaseDate`-desc grid order) as a STABLE
 * tiebreaker. Without this, equal or unparseable dates reorder
 * nondeterministically across requests; the tiebreaker keeps the official
 * grid order Sony already returns for ties (see the spike doc, section B).
 */
export const sortByDate = (
  games: readonly Game[],
  order: SortOrder,
): Game[] => {
  const sentinel =
    order === 'date-desc' ? DATE_DESC_SENTINEL : DATE_ASC_SENTINEL
  const tsOf = (game: Game): number => {
    const parsed = Date.parse(game.date)
    return Number.isNaN(parsed) ? sentinel : parsed
  }

  return games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => {
      const aTs = tsOf(a.game)
      const bTs = tsOf(b.game)
      const byDate = order === 'date-desc' ? bTs - aTs : aTs - bTs
      return byDate !== 0 ? byDate : a.index - b.index
    })
    .map((entry) => entry.game)
}

export const paginate = (
  games: readonly Game[],
  offset: number,
  size: number,
): PageResult => {
  const page = games.slice(offset, offset + size)
  const nextOffset = offset + size < games.length ? offset + size : null
  return { games: page, totalCount: games.length, nextOffset }
}

export type DateFilter = 'released' | 'none'

export const applyDateFilter = (
  games: readonly Game[],
  filter: DateFilter,
): Game[] => {
  if (filter === 'none') return [...games]
  const now = Date.now()
  return games.filter((game) => Date.parse(game.date) <= now)
}

export const mapConceptsToGames = (concepts: readonly Concept[]): Game[] => {
  const mapped = concepts
    .map((concept) => conceptToGame(concept))
    .filter((game) => Boolean(game.id) && isValidProductId(game.id))

  // decode returns a readonly array; copy to a mutable one for callers.
  return [...decodeGames(mapped)]
}

// UPCOMING-only mapping. Unlike `mapConceptsToGames` (used VERBATIM by
// NEW / DISCOUNTED), this keeps concept-only announcements that Sony does not
// expose as a priced product SKU anonymously: it drops only truly id-less
// entries, not the SKU-less ones. `idKind` is derived HERE, once, so the shared
// mapper and the NEW / DISCOUNTED output stay byte-identical — a `product` id
// matches the existing `PRODUCT_ID_PATTERN` (internal PDP); anything else is a
// bare concept id that links out to Sony's concept page (owner ruling
// 2026-05-29). Owner-authorised, UPCOMING-scoped exception (VISION.md).
export const mapUpcomingConceptsToGames = (
  concepts: readonly Concept[],
): Game[] => {
  const mapped = concepts
    .map((concept) => conceptToGame(concept))
    .filter((game) => Boolean(game.id))
    .map((game) => ({
      ...game,
      idKind: isValidProductId(game.id)
        ? ('product' as const)
        : ('concept' as const),
    }))

  return [...decodeGames(mapped)]
}

// Allow-list of Sony `storeDisplayClassification` values that are full games.
// Conservative by design: unknown / future classifications are excluded so a
// new non-game SKU type can never silently leak into the games-only grid.
// PREMIUM_EDITION is excluded for edition de-duplication; including it would be
// a one-line addition here.
export const DISCOUNTED_GAME_CLASSIFICATIONS = new Set([
  'FULL_GAME',
  'GAME_BUNDLE',
])

export const conceptProductId = (concept: Concept): string =>
  concept.products?.[0]?.id ?? concept.id ?? ''
