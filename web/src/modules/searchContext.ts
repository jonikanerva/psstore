import { createContext, useContext } from 'react'

// Local UI state only: the free-text filter of the current view. It is never
// persisted and never part of a games query key. The global search term lives
// in the URL and in the in-memory `['search', term]` key, which the persister
// allow-list (`persistence.ts`) rejects.
export const SearchContext = createContext<string>('')

export const useSearchQuery = (): string => useContext(SearchContext)
