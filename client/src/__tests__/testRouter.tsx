import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
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
): Promise<RenderResult> => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

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
