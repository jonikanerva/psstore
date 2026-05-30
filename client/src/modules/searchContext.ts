import { createContext, useContext } from 'react'

// Local UI state only — the free-text search that filters the visible list by
// name. It is NEVER persisted and NEVER a query key (so localStorage carries no
// search/behaviour state — VISION privacy posture, ux condition 1, da #4).
export const SearchContext = createContext<string>('')

export const useSearchQuery = (): string => useContext(SearchContext)
