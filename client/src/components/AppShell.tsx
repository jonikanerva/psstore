import { Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { SearchContext } from '../modules/searchContext'
import Navigation from './Navigation'

const AppShell = () => {
  const [query, setQuery] = useState('')
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // Clear the search when the route changes — the search is per-view and never
  // remembered (ux condition 3).
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
