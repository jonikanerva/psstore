import { createContext, useContext } from 'react'
import type { GameSort } from '@psstore/shared'

// Local UI state only: the sort of the current view, or null for Sony's own
// order. It is never persisted, never in the URL and never part of a query key.
export const SortContext = createContext<GameSort | null>(null)

export const useSort = (): GameSort | null => useContext(SortContext)
