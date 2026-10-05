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

// The PS Plus label on a list card (Sony's `upsellText`) for a game that a
// tier includes. Live 2026-10-05: "Extra" is a game catalog entry
// (UPSELL_PS_PLUS_GAME_CATALOG) and "Essential" a free PS Plus item. "Save
// 10%" is a discount. "Premium" is a game trial (UPSELL_PS_PLUS_TRIAL) on 67
// of 71 live games and a Premium Classic on 4. The list data cannot tell them
// apart, so a "Premium" label keeps the standard price (owner decision
// 2026-10-05). The game page and the wishlist read the exact offer type.
const PLUS_INCLUDED_LABELS: ReadonlySet<string> = new Set([
  'essential',
  'extra',
])

// A game the viewer gets at no cost sorts as 0 €. The product assumes a PS
// Plus Premium member, who has every tier, so a game that any tier includes
// is free. The game page and the wishlist know the PS Plus offer; the list
// cards know only the label.
const priceKey = (game: Game): number | null => {
  const label = game.plusUpsellText?.trim().toLowerCase() ?? ''
  return game.plusOffer?.kind === 'included' || PLUS_INCLUDED_LABELS.has(label)
    ? 0
    : parsePrice(game.price)
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
  const key = field === 'date' ? dateKey : priceKey
  return [...games].sort((a, b) =>
    compareKeys(key(a), key(b), direction, numeric),
  )
}
