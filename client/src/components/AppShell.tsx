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
import { wishlistQueryOptions } from '../modules/wishlistQuery'
import { usePrefetchTabs } from '../modules/usePrefetchTabs'
import { SearchContext } from '../modules/searchContext'
import { SortContext } from '../modules/sortContext'
import { isSameSort, sortConfigForPath } from '../modules/sortFields'
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
  const stopSignedInPrefetch = usePrefetchTabs()

  // The sort belongs to the view it was chosen on: arriving on another
  // pathname, or on a search for another term, drops it.
  const sortScope = onSearchRoute ? `${SEARCH_PATH}?q=${urlTerm}` : pathname
  const [sortState, setSortState] = useState<{
    scope: string
    sort: GameSort | null
  }>({ scope: sortScope, sort: null })
  if (sortState.scope !== sortScope) {
    setSortState({ scope: sortScope, sort: null })
  }
  const sort = sortState.scope === sortScope ? sortState.sort : null
  const loadRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      loadRef.current?.abort()
    },
    [sortScope],
  )

  const sortConfig = sortConfigForPath(pathname)

  // `null` is the route default of a server-ordered view: the server order,
  // with no pages loaded on purpose. Any other sort needs every page, so
  // choosing one loads the remaining pages of the open view. A view that is not
  // server-ordered keeps its default as an applied sort.
  const applySort = (next: GameSort) => {
    loadRef.current?.abort()
    if (sortConfig === undefined) {
      return
    }
    if (isSameSort(next, sortConfig.defaultSort)) {
      setSortState({ scope: sortScope, sort: null })
      return
    }
    setSortState({ scope: sortScope, sort: next })
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

  const activeSort = sort ?? sortConfig?.defaultSort
  const appliedSort = sortConfig?.serverOrdered === false ? activeSort : sort

  const clickField = (field: SortField) => {
    if (activeSort === undefined) {
      return
    }
    applySort(
      activeSort.field === field
        ? {
            field,
            direction: activeSort.direction === 'asc' ? 'desc' : 'asc',
          }
        : { field, direction: NATURAL_DIRECTION[field] },
    )
  }

  const resetSort = () => {
    if (sortConfig !== undefined) {
      applySort(sortConfig.defaultSort)
    }
  }

  // A signed-in search has nothing to filter until its list exists, and Sign
  // out shows while either list does. `enabled: false` observes the shared
  // query without starting a fetch.
  const library = useQuery({ ...purchasedQueryOptions, enabled: false })
  const wishlist = useQuery({ ...wishlistQueryOptions, enabled: false })
  const searchDisabled =
    (pathname === '/purchased' && library.data === undefined) ||
    (pathname === '/wishlist' && wishlist.data === undefined)
  const showSortBar =
    !searchDisabled && sortConfig !== undefined && activeSort !== undefined

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
          {(library.data !== undefined || wishlist.data !== undefined) && (
            <SignOut onSignOut={stopSignedInPrefetch} />
          )}
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
      {showSortBar && (
        <SortControl
          fields={sortConfig.fields}
          active={activeSort}
          onFieldClick={clickField}
          onReset={resetSort}
        />
      )}
      <main className="app-shell--main">
        <SearchContext.Provider value={onSearchRoute ? '' : query}>
          <SortContext.Provider value={appliedSort ?? null}>
            <Outlet />
          </SortContext.Provider>
        </SearchContext.Provider>
      </main>
    </div>
  )
}

export default AppShell
