import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { SearchContext } from '../modules/searchContext'
import {
  normalizeSearchTerm,
  readSearchTerm,
  SEARCH_TERM_MAX_LENGTH,
} from '../modules/searchTerm'
import Navigation from './Navigation'

const SEARCH_PATH = '/search'

const AppShell = () => {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const urlTerm = useRouterState({
    select: (state) => readSearchTerm(state.location.search),
  })
  const onSearchRoute = pathname === SEARCH_PATH

  // Outside the search route the field filters the current view and clears
  // with the route. On the search route the URL term seeds the field, and
  // edits stay local until the form is submitted.
  useEffect(() => {
    setQuery(onSearchRoute ? urlTerm : '')
  }, [pathname, onSearchRoute, urlTerm])

  const term = normalizeSearchTerm(query)

  return (
    <div className="app-shell">
      <header className="app-shell--header">
        <div className="app-shell--brand">PS Store</div>
        <Navigation />
        <form
          role="search"
          className="app-shell--search-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (term === '') {
              setQuery('')
              void navigate({ to: '/' })
            } else {
              void navigate({ to: SEARCH_PATH, search: { q: term } })
            }
          }}
        >
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={SEARCH_TERM_MAX_LENGTH}
            className="app-shell--search"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
            }}
          />
        </form>
      </header>
      <main className="app-shell--main">
        <SearchContext.Provider value={onSearchRoute ? '' : query}>
          <Outlet />
        </SearchContext.Provider>
      </main>
    </div>
  )
}

export default AppShell
