// Decides whether a third-party candidate is the same game as the Sony game and
// whether its critic score is trustworthy. Pure: no I/O, no ambient clock.

// A candidate needs at least this many critic reviews behind its score.
export const MIN_CRITIC_COUNT = 3

export interface CriticCandidate {
  readonly name: string
  // UTC calendar year of the first release; null when the provider has none.
  readonly releaseYear: number | null
  // Integer 0 to 100; null when the provider has no usable critic score.
  readonly rating: number | null
  readonly ratingCount: number
}

// Closed list. Each entry is a normalised trailing phrase of a Sony title that
// names a store edition or platform, not a different game. A remaster or a
// director's cut is a different game and is not in this list.
const EDITION_SUFFIXES: readonly string[] = [
  'ps5 edition',
  'playstation 5 edition',
  'ps5 version',
  'digital edition',
  'standard edition',
  'deluxe edition',
  'digital deluxe edition',
  'ultimate edition',
  'premium edition',
  'complete edition',
  'definitive edition',
  'special edition',
  'gold edition',
  'collectors edition',
  'game of the year edition',
  'goty edition',
  'ps4 ps5',
  'ps4 and ps5',
  'ps5',
  'playstation 5',
]

const LONGEST_FIRST = [...EDITION_SUFFIXES].sort((a, b) => b.length - a.length)

const MARKS = /[̀-ͯ]/g
const SYMBOLS = /[™®©'’]/g
const NON_ALNUM = /[^\p{L}\p{N}]+/gu

const stripEditionSuffixes = (value: string): string => {
  let current = value
  for (;;) {
    const suffix = LONGEST_FIRST.find((candidate) =>
      current.endsWith(` ${candidate}`),
    )
    if (suffix === undefined) {
      return current
    }
    current = current.slice(0, current.length - suffix.length - 1).trim()
  }
}

/** Lower-case, accent-free, punctuation-free title without edition suffixes. */
export const normalizeTitle = (name: string): string =>
  stripEditionSuffixes(
    name
      .replace(SYMBOLS, '')
      .normalize('NFKD')
      .replace(MARKS, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(NON_ALNUM, ' ')
      .trim(),
  )

/** UTC year of an ISO instant; null for an empty or unparseable value. */
export const releaseYearOf = (date: string): number | null => {
  const ms = Date.parse(date)
  return Number.isNaN(ms) ? null : new Date(ms).getUTCFullYear()
}

/**
 * The critic score for a game, or null. Accepts a candidate only when its
 * normalised name equals the game's, its release year is within one year of
 * the game's, and it has a score from enough critic reviews. Exactly one such
 * candidate must exist; two are ambiguous.
 */
export const matchCriticScore = (
  title: string,
  year: number,
  candidates: readonly CriticCandidate[],
): number | null => {
  const name = normalizeTitle(title)
  if (name === '') {
    return null
  }

  // An edition entry often shares the base game's normalised name. Only a
  // candidate with a trusted score takes part in the uniqueness check.
  const qualified = candidates.filter(
    (candidate) =>
      candidate.releaseYear !== null &&
      Math.abs(candidate.releaseYear - year) <= 1 &&
      candidate.rating !== null &&
      candidate.ratingCount >= MIN_CRITIC_COUNT &&
      normalizeTitle(candidate.name) === name,
  )
  const [only] = qualified
  return qualified.length === 1 && only !== undefined ? only.rating : null
}
