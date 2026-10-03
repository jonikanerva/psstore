import { gamesSchema, type Game, type PageResult } from '@psstore/shared'
import { Schema } from 'effect'
import {
  conceptToGame,
  monthlyEntryToGame,
  productToConcept,
} from '../sony/mapper.js'
import type { PlusMonthlyEntry } from '../sony/plusMonthlySchema.js'
import type { SearchEntry } from '../sony/searchSchema.js'
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
 * grid order Sony already returns for ties.
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

// MONTHLY order is the game's release date, newest first: the feed carries no
// date the game was added to PS Plus.
export const mapMonthlyToGames = (
  entries: readonly PlusMonthlyEntry[],
): Game[] =>
  sortByDate([...decodeGames(entries.map(monthlyEntryToGame))], 'date-desc')

// UPCOMING-only mapping. Unlike `mapConceptsToGames` (used VERBATIM by
// NEW / DISCOUNTED), this keeps concept-only announcements that Sony does not
// expose as a priced product SKU anonymously: it drops only truly id-less
// entries, not the SKU-less ones. `idKind` is derived HERE, once, so the shared
// mapper and the NEW / DISCOUNTED output stay byte-identical — a `product` id
// matches the existing `PRODUCT_ID_PATTERN` (internal PDP); anything else is a
// bare concept id that links out to Sony's concept page. This UPCOMING-scoped
// exception is allowed by VISION.md; do not extend it to other features.
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

export const PS5_PLATFORM = 'PS5'

export const isPs5Game = (
  platforms: readonly string[] | null | undefined,
  classification: string | null | undefined,
): boolean =>
  (platforms ?? []).includes(PS5_PLATFORM) &&
  classification !== null &&
  classification !== undefined &&
  DISCOUNTED_GAME_CLASSIFICATIONS.has(classification)

// A search result that survived narrowing. `known`: the search response itself
// proves PS5 and a game classification. `unverified`: a concept that names a
// product id; platforms and classification must come from the product detail.
export type SearchCandidate =
  | { readonly kind: 'known'; readonly concept: Concept }
  | {
      readonly kind: 'unverified'
      readonly productId: string
      readonly concept: Concept
    }

const candidateId = (candidate: SearchCandidate): string =>
  candidate.kind === 'known'
    ? conceptProductId(candidate.concept)
    : candidate.productId

const narrowSearchEntry = (entry: SearchEntry): SearchCandidate | null => {
  if (entry.kind === 'product') {
    const { product } = entry
    return product.id !== null &&
      product.id !== undefined &&
      isValidProductId(product.id) &&
      isPs5Game(product.platforms, product.storeDisplayClassification)
      ? { kind: 'known', concept: productToConcept(product) }
      : null
  }

  const productId = entry.concept.products?.[0]?.id
  return productId !== null &&
    productId !== undefined &&
    isValidProductId(productId)
    ? { kind: 'unverified', productId, concept: entry.concept }
    : null
}

// Scope narrowing for search: Sony applies no platform filter, so only PS5
// game products and concepts that name a valid product id survive. Keeps
// Sony's relevance order and the first occurrence of a repeated id.
export const narrowSearchEntries = (
  entries: readonly SearchEntry[],
): SearchCandidate[] => {
  const seen = new Set<string>()
  const candidates: SearchCandidate[] = []
  for (const entry of entries) {
    const candidate = narrowSearchEntry(entry)
    if (candidate === null) {
      continue
    }
    const id = candidateId(candidate)
    if (!seen.has(id)) {
      seen.add(id)
      candidates.push(candidate)
    }
  }
  return candidates
}
