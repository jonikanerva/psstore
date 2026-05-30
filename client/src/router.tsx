import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import AppShell from './components/AppShell'
import Details from './components/Details'
import Games from './components/Games'
import {
  fetchDiscountedGames,
  fetchNewGames,
  fetchUpcomingGames,
} from './modules/psnStore'

// Code-based route tree. Root renders the AppShell (header + Outlet). The index
// redirects to /new so the default entry is always NEW, newest-first (VISION);
// no last-view is remembered (ux condition 3). A splat route catches any unknown
// path and redirects to /new.

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

const detailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'g/$gameId',
  component: Details,
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
  detailsRoute,
  splatRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
