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
import {
  FocusReturnContext,
  GAME_PAGE_PREFIX,
  gamePagePath,
  viewKeyFor,
  type PendingFocus,
} from '../modules/focusReturn'
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

interface ViewState {
  key: string
  sort: GameSort | null
  // Outside the search route: the filter of the list. On the search route: the
  // draft of the field, seeded from the URL term.
  query: string
}

const AppShell = () => {
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

  const onGamePage = pathname.startsWith(GAME_PAGE_PREFIX)
  const viewKey = viewKeyFor(pathname, urlTerm)
  const freshView = (): ViewState => ({
    key: viewKey,
    sort: null,
    query: onSearchRoute ? urlTerm : '',
  })

  // The sort and the filter belong to the list view they were set on. The game
  // page keeps them while it is open, so closing it returns to the same list;
  // any other view change resets both. Memory only.
  const [view, setView] = useState<ViewState>(freshView)
  if (!onGamePage && view.key !== viewKey) {
    setView(freshView())
  }
  const { sort, query } = view
  const setQuery = (next: string) => {
    setView((previous) => ({ ...previous, query: next }))
  }

  const focusReturn = useRef<PendingFocus | null>(null)
  useEffect(() => {
    const pending = focusReturn.current
    if (pending === null) {
      return
    }
    const stale = onGamePage
      ? pathname !== gamePagePath(pending.gameId)
      : pending.fromKey !== viewKey
    if (stale) {
      focusReturn.current = null
    }
  }, [pathname, viewKey, onGamePage])
  const sortConfig = sortConfigForPath(pathname)

  // `null` is the route default of a server-ordered view: the server order,
  // with no pages loaded on purpose. Any other sort needs every page, so
  // choosing one loads the remaining pages of the open view. A view that is not
  // server-ordered keeps its default as an applied sort.
  const applySort = (next: GameSort) => {
    if (sortConfig === undefined) {
      return
    }
    if (isSameSort(next, sortConfig.defaultSort)) {
      setView((previous) => ({ ...previous, sort: null }))
      return
    }
    setView((previous) => ({ ...previous, sort: next }))
  }

  // The loader owns the load of a kept sort: it starts whenever a sorted list
  // is on screen, so a list that lost its pages while the game page was open
  // loads again. Leaving the list aborts it.
  const sortedTarget = sort === null ? undefined : gamesFeatureForPath(pathname)
  useEffect(() => {
    if (sortedTarget === undefined) {
      return
    }
    const controller = new AbortController()
    void loadAllPages(
      queryClient,
      gamesQueryOptions(sortedTarget.feature, sortedTarget.fetch),
      controller.signal,
    )
    return () => {
      controller.abort()
    }
  }, [queryClient, sortedTarget])

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
        <FocusReturnContext.Provider value={focusReturn}>
          <SearchContext.Provider value={onSearchRoute ? '' : query}>
            <SortContext.Provider value={appliedSort ?? null}>
              <Outlet />
            </SortContext.Provider>
          </SearchContext.Provider>
        </FocusReturnContext.Provider>
      </main>
    </div>
  )
}

export default AppShell
