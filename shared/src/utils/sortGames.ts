import type { Game } from '../types/game.js'

export type SortField = 'date' | 'price' | 'name'
export type SortDirection = 'asc' | 'desc'
export interface GameSort {
  readonly field: SortField
  readonly direction: SortDirection
}

export const NATURAL_DIRECTION = {
  date: 'desc',
  price: 'asc',
  name: 'asc',
} as const satisfies Record<SortField, SortDirection>

const nameCollator = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
})

// Accepts "12,99 €", "€44,95", "1 234,50 €" and "1.234,50 €": an optional
// euro sign on either side, digit groups of three split by a space, NBSP or
// dot, and a decimal comma with one or two digits. Sony's "Free" is a price of
// 0. Anything else (for example "Included", "Game Trial", "12.99", "1,234") is
// not a price.
const PRICE_PATTERN =
  /^(?:€\s?)?(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{1,2}))?(?:\s?€)?$/u

export const parsePrice = (text: string): number | null => {
  const normalized = text.replace(/[  ]/gu, ' ').trim()
  if (normalized.toLowerCase() === 'free') {
    return 0
  }
  const match = PRICE_PATTERN.exec(normalized)
  if (match === null) {
    return null
  }
  const whole = (match[1] ?? '').replace(/[ .]/gu, '')
  const fraction = match[2] ?? '0'
  return Number(`${whole}.${fraction}`)
}

const dateKey = (game: Game): number | null => {
  const ts = Date.parse(game.date)
  return Number.isFinite(ts) ? ts : null
}

const nameKey = (game: Game): string | null =>
  game.name.trim() === '' ? null : game.name

const compareKeys = <T extends number | string>(
  a: T | null,
  b: T | null,
  direction: SortDirection,
  compare: (x: T, y: T) => number,
): number => {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1
  }
  const order = compare(a, b)
  return direction === 'asc' ? order : -order
}

const numeric = (x: number, y: number): number => x - y

// Returns a copy. A game with no usable key sorts last in both directions;
// equal keys keep their input order.
export const sortGames = (games: readonly Game[], sort: GameSort): Game[] => {
  const { field, direction } = sort
  if (field === 'name') {
    return [...games].sort((a, b) =>
      compareKeys(nameKey(a), nameKey(b), direction, (x, y) =>
        nameCollator.compare(x, y),
      ),
    )
  }
  const key = field === 'date' ? dateKey : (g: Game) => parsePrice(g.price)
  return [...games].sort((a, b) =>
    compareKeys(key(a), key(b), direction, numeric),
  )
}
