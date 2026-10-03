import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'

// Renders an arbitrary element under a minimal in-memory TanStack Router plus a
// fresh QueryClient — the harness component tests need for Link / useParams /
// useQuery. Each call gets an isolated client so caches never leak between
// tests, and a non-persisting client so localStorage stays untouched.
export const renderWithRouter = async (
  ui: ReactNode,
  queryClient: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  }),
): Promise<RenderResult> => {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  // Resolve the initial match before rendering so the component mounts
  // synchronously for the assertions (the router otherwise matches on a
  // microtask, leaving the first render empty).
  await router.load()

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

// Renders a route table under an in-memory router at a chosen history stack,
// and returns the router so a test can read the location and the history.
export const renderRoutes = async (
  routes: Readonly<Record<string, () => ReactNode>>,
  initialEntries: string[],
  initialIndex?: number,
) => {
  const rootRoute = createRootRoute({ component: Outlet })
  const children = Object.entries(routes).map(([path, Component]) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: Component,
    }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({
      initialEntries,
      ...(initialIndex === undefined ? {} : { initialIndex }),
    }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}
