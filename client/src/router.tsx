import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import type { PdpOrigin } from './modules/pdpOrigin'
import AppShell from './components/AppShell'
import Details from './components/Details'
import Games from './components/Games'
import Purchased from './components/Purchased'
import SearchResults from './components/SearchResults'
import Wishlist from './components/Wishlist'
import {
  fetchDiscountedGames,
  fetchMonthlyGames,
  fetchNewGames,
  fetchUpcomingGames,
} from './modules/psnStore'
import {
  parseSearch,
  readSearchTerm,
  stringifySearch,
} from './modules/searchTerm'

// Code-based route tree. Root renders the AppShell (header + Outlet). The index
// redirects to /new so the default entry is always NEW, newest-first (VISION);
// never remember the last view. A splat route catches any unknown path and
// redirects to /new.

const rootRoute = createRootRoute({
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    // TanStack Router signals navigation by throwing a redirect descriptor (not
    // an Error subclass); this is the framework's documented control-flow API.
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() is the router's throw-to-navigate contract
    throw redirect({ to: '/new' })
  },
})

const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'new',
  component: () => <Games feature="new" fetch={fetchNewGames} />,
})

const upcomingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'upcoming',
  component: () => <Games feature="upcoming" fetch={fetchUpcomingGames} />,
})

const discountedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'discounted',
  component: () => <Games feature="discounted" fetch={fetchDiscountedGames} />,
})

const monthlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'monthly',
  component: () => (
    <Games
      feature="monthly"
      fetch={fetchMonthlyGames}
      emptyMessage="No PS Plus monthly games right now"
    />
  ),
})

const wishlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'wishlist',
  component: Wishlist,
})

const purchasedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'purchased',
  component: Purchased,
})

const detailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'g/$gameId',
  component: Details,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'search',
  validateSearch: (search: Record<string, unknown>) => ({
    q: readSearchTerm(search),
  }),
  beforeLoad: ({ search }) => {
    if (search.q === '') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() is the router's throw-to-navigate contract
      throw redirect({ to: '/new' })
    }
  },
  component: () => <SearchResults term={searchRoute.useSearch().q} />,
})

const splatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  beforeLoad: () => {
    // TanStack Router signals navigation by throwing a redirect descriptor (not
    // an Error subclass); this is the framework's documented control-flow API.
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() is the router's throw-to-navigate contract
    throw redirect({ to: '/new' })
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  newRoute,
  upcomingRoute,
  discountedRoute,
  monthlyRoute,
  wishlistRoute,
  purchasedRoute,
  detailsRoute,
  searchRoute,
  splatRoute,
])

export const router = createRouter({
  routeTree,
  parseSearch,
  stringifySearch,
  scrollRestoration: true,
})

declare module '@tanstack/history' {
  interface HistoryState {
    pdpOrigin?: PdpOrigin | undefined
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
