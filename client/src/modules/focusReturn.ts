import { createContext, useContext, type RefObject } from 'react'

export interface PendingFocus {
  gameId: string
  // The view key of the list the card was opened from (`viewKeyFor`).
  fromKey: string
}

// Owned by the app shell. Memory only: never persisted, never in the URL.
export const FocusReturnContext =
  createContext<RefObject<PendingFocus | null> | null>(null)

export const useFocusReturn = (): RefObject<PendingFocus | null> | null =>
  useContext(FocusReturnContext)

export const GAME_PAGE_PREFIX = '/g/'

export const gamePagePath = (gameId: string): string =>
  `${GAME_PAGE_PREFIX}${encodeURIComponent(gameId)}`

// A list view is its pathname; the search route is one view per submitted term.
export const viewKeyFor = (pathname: string, searchTerm: string): string =>
  pathname === '/search' ? `/search?${searchTerm}` : pathname

// Takes the pending focus once. It acts only for the list it came from, and
// never moves focus the user has already placed on an element.
export const consumeFocusReturn = (
  pending: RefObject<PendingFocus | null>,
  viewKey: string,
  grid: HTMLElement,
): void => {
  const target = pending.current
  if (target === null || target.fromKey !== viewKey) {
    return
  }
  pending.current = null
  const active = document.activeElement
  if (active !== null && active !== document.body) {
    return
  }
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('a.game-card'))
  const card =
    cards.find((candidate) => candidate.dataset['gameId'] === target.gameId) ??
    cards[0]
  if (card === undefined) {
    return
  }
  card.focus({ preventScroll: true })
  card.scrollIntoView({ block: 'nearest' })
}
