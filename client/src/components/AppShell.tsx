import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  NATURAL_DIRECTION,
  type GameSort,
  type SortField,
} from '@psstore/shared'
import {
  gamesFeatureForPath,
  gamesQueryOptions,
  loadAllPages,
} from '../modules/gamesQuery'
import { purchasedQueryOptions } from '../modules/purchasedQuery'
import { SearchContext } from '../modules/searchContext'
import { SortContext } from '../modules/sortContext'
import { sortFieldsForPath } from '../modules/sortFields'
import {
  normalizeSearchTerm,
  readSearchTerm,
  SEARCH_TERM_MAX_LENGTH,
} from '../modules/searchTerm'
import Navigation from './Navigation'
import SignOut from './SignOut'
import SortControl from './SortControl'

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
  const queryClient = useQueryClient()

  // The sort belongs to the route it was chosen on: arriving on another
  // pathname drops it.
  const [sortState, setSortState] = useState<{
    pathname: string
    sort: GameSort | null
  }>({ pathname, sort: null })
  if (sortState.pathname !== pathname) {
    setSortState({ pathname, sort: null })
  }
  const sort = sortState.pathname === pathname ? sortState.sort : null
  const loadRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      loadRef.current?.abort()
    },
    [pathname],
  )

  // A sort needs every page, so picking one loads the remaining pages of the
  // open view. Nothing loads while the sort is idle.
  const changeField = (field: SortField | null) => {
    loadRef.current?.abort()
    if (field === null) {
      setSortState({ pathname, sort: null })
      return
    }
    setSortState({
      pathname,
      sort: { field, direction: NATURAL_DIRECTION[field] },
    })
    const target = gamesFeatureForPath(pathname)
    if (target !== undefined) {
      const controller = new AbortController()
      loadRef.current = controller
      void loadAllPages(
        queryClient,
        gamesQueryOptions(target.feature, target.fetch),
        controller.signal,
      )
    }
  }

  const toggleDirection = () => {
    if (sort !== null) {
      setSortState({
        pathname,
        sort: {
          field: sort.field,
          direction: sort.direction === 'asc' ? 'desc' : 'asc',
        },
      })
    }
  }

  // The PURCHASED search has nothing to filter until the library list exists,
  // and Sign out shows only while it does. `enabled: false` observes the shared
  // query without starting a fetch.
  const library = useQuery({ ...purchasedQueryOptions, enabled: false })
  const searchDisabled = pathname === '/purchased' && library.data === undefined
  const sortFields = searchDisabled ? [] : sortFieldsForPath(pathname)

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
        <div className="app-shell--tools">
          {library.data !== undefined && <SignOut />}
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
              disabled={searchDisabled}
              className="app-shell--search"
              value={query}
              onChange={(e) => {
                setQuery(e.currentTarget.value)
              }}
            />
          </form>
        </div>
      </header>
      {sortFields.length > 0 && (
        <SortControl
          fields={sortFields}
          sort={sort}
          onFieldChange={changeField}
          onToggleDirection={toggleDirection}
        />
      )}
      <main className="app-shell--main">
        <SearchContext.Provider value={onSearchRoute ? '' : query}>
          <SortContext.Provider value={sort}>
            <Outlet />
          </SortContext.Provider>
        </SearchContext.Provider>
      </main>
    </div>
  )
}

export default AppShell
