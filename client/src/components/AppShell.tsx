import { Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { purchasedQueryOptions } from '../modules/purchasedQuery'
import { SearchContext } from '../modules/searchContext'
import Navigation from './Navigation'

const AppShell = () => {
  const [query, setQuery] = useState('')
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  // The PURCHASED search has nothing to filter until the library list exists.
  // `enabled: false` observes the shared query without starting a fetch.
  const library = useQuery({ ...purchasedQueryOptions, enabled: false })
  const searchDisabled = pathname === '/purchased' && library.data === undefined

  // Clear the search when the route changes — the search is per-view and never
  // remembered.
  useEffect(() => {
    setQuery('')
  }, [pathname])

  return (
    <div className="app-shell">
      <header className="app-shell--header">
        <div className="app-shell--brand">PS Store</div>
        <Navigation />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={searchDisabled}
          className="app-shell--search"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value)
          }}
        />
      </header>
      <main className="app-shell--main">
        <SearchContext.Provider value={query}>
          <Outlet />
        </SearchContext.Provider>
      </main>
    </div>
  )
}

export default AppShell
