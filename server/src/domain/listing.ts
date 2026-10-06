import {
  gamesSchema,
  isGenreKey,
  isValidProductId,
  type Game,
  type Genre,
  type PageResult,
} from '@psstore/shared'
import { Schema } from 'effect'
import {
  conceptToGame,
  isConceptDiscounted,
  monthlyEntryToGame,
  productToConcept,
} from '../sony/mapper.js'
import type { RawGenre } from '../sony/categoryGridSchema.js'
import type { PlusMonthlyEntry } from '../sony/plusMonthlySchema.js'
import type { SearchEntry } from '../sony/searchSchema.js'
import type { Concept } from '../sony/types.js'

// Pure domain core: sorting, pagination, scope filtering, and concept→game
// mapping. No I/O (no fetch, cache, clock-as-service) is imported here — those
// live in the infrastructure/service layer. The current instant arrives as a
// parameter; `Date.parse` is the only date read.

const decodeGames = Schema.decodeUnknownSync(gamesSchema)

export { isValidProductId }

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

// NEW and UPCOMING split at the start of the viewer's next local day. The
// client makes that split (docs/adr/0001-new-upcoming-day-split.md). In every
// time zone, the next local midnight is at most 25 hours after the current
// instant (24 hours, plus 1 hour on the day that daylight saving time ends).
// The margin absorbs a client clock that is up to 12 hours off. The server
// therefore sends each list a superset of the client's result: the games in
// the overlap reach both lists, and the client keeps each in one.
const MAX_LOCAL_DAY_MS = 25 * 60 * 60 * 1000
const CLIENT_CLOCK_MARGIN_MS = 12 * 60 * 60 * 1000

const releaseMs = (game: Game): number => Date.parse(game.date)

// The released grid holds released games. A product of that grid without a
// parseable date (for example after a failed detail lookup) is dropped: it is
// not shown as upcoming.
export const hasReleaseDate = (game: Game): boolean =>
  !Number.isNaN(releaseMs(game))

// NEW: a dated game that is released, or released before the latest possible
// local midnight. A game without a parseable date is never NEW.
export const inNewWindow = (games: readonly Game[], nowMs: number): Game[] =>
  games.filter(
    (game) =>
      releaseMs(game) < nowMs + MAX_LOCAL_DAY_MS + CLIENT_CLOCK_MARGIN_MS,
  )

// UPCOMING: a game released after the earliest possible local midnight, or a
// game without a parseable date. Only the upcoming grid supplies undated games:
// a concept-only announcement, or a product whose date is unknown.
export const inUpcomingWindow = (
  games: readonly Game[],
  nowMs: number,
): Game[] =>
  games.filter((game) => {
    const ms = releaseMs(game)
    return Number.isNaN(ms) || ms >= nowMs - CLIENT_CLOCK_MARGIN_MS
  })

// Sony files a game in the released grid (`last_thirty_days`) or the upcoming
// grid (`next_thirty_days`) by the concept release date. A product can be out
// while its concept is still upcoming, so NEW and UPCOMING read both grids and
// classify by the product date. The first occurrence of a repeated id wins.
export const mergeReleaseGrids = (
  released: readonly Game[],
  upcoming: readonly Game[],
): Game[] => {
  const seen = new Set<string>()
  return [...released, ...upcoming].filter((game) => {
    if (seen.has(game.id)) {
      return false
    }
    seen.add(game.id)
    return true
  })
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

// ---- BROWSE ----------------------------------------------------------------

// Sony's genre facet narrowed to keys that the API accepts. The first entry of
// a repeated key wins. Sorted by display name, so the genre menu is
// alphabetical.
export const narrowGenres = (genres: readonly RawGenre[]): Genre[] => {
  const seen = new Set<string>()
  return genres
    .filter((genre) => {
      if (!isGenreKey(genre.key) || seen.has(genre.key)) {
        return false
      }
      seen.add(genre.key)
      return true
    })
    .map((genre) => ({ key: genre.key, name: genre.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

// A PS5 title id has the `PPSA` prefix in the product id, for example
// `EP0006-PPSA04874_00-APEXLEGENDRSPWN1`. A PS4 title id has `CUSA`.
const PS5_TITLE_PRODUCT_ID = /^[A-Z]{2}\d{4}-PPSA\d{5}_00-/

// Product lookups for one BROWSE concept at most. Observed 2026-10-06 on the
// First Person Shooter genre: 228 of 232 concepts resolve, 221 at the first
// candidate and none after the third.
export const BROWSE_MAX_CANDIDATES = 3

/**
 * The product ids to try for one BROWSE concept, in order. Sony's first
 * product of a concept can be the PS4 version, a demo, or a premium edition.
 * PS5 title ids come first and otherwise Sony's order stays. The prefix is an
 * ordering hint only: the caller accepts a candidate only after its product
 * detail proves a PS5 game (`isPs5Game`). A concept without a product id
 * returns no candidate and is dropped.
 */
export const browseCandidateIds = (concept: Concept): string[] => {
  const ids = [
    ...new Set(
      (concept.products ?? []).flatMap((product) =>
        product.id && isValidProductId(product.id) ? [product.id] : [],
      ),
    ),
  ]
  return [
    ...ids.filter((id) => PS5_TITLE_PRODUCT_ID.test(id)),
    ...ids.filter((id) => !PS5_TITLE_PRODUCT_ID.test(id)),
  ].slice(0, BROWSE_MAX_CANDIDATES)
}

/**
 * The BROWSE card of a concept, built for the product that passed the scope
 * check. The name, cover and list price come from the concept; the date and
 * genres come from that product's detail. `nowMs` sets the pre-order flag.
 */
export const browseConceptToGame = (
  concept: Concept,
  productId: string,
  detail: { readonly releaseDate: string; readonly genres: readonly string[] },
  nowMs: number,
): Game => {
  const base = conceptToGame(concept)
  const releaseMs = Date.parse(detail.releaseDate)
  const date = Number.isNaN(releaseMs) ? '' : new Date(releaseMs).toISOString()
  return (
    decodeGames([
      {
        ...base,
        id: productId,
        date,
        discountDate: isConceptDiscounted(concept) ? date : '',
        genres: detail.genres.length > 0 ? [...detail.genres] : base.genres,
        preOrder: date !== '' && releaseMs > nowMs,
      },
    ])[0] ?? base
  )
}
