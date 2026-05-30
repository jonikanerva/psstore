import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from '../components/AppShell'
import { useSearchQuery } from '../modules/searchContext'

const QueryProbe = () => {
  const query = useSearchQuery()
  return <div data-testid="probe-query">{query}</div>
}

const renderShellAt = async (initial: string) => {
  const rootRoute = createRootRoute({ component: AppShell })
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'new',
    component: QueryProbe,
  })
  const discountedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'discounted',
    component: QueryProbe,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([newRoute, discountedRoute]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  await router.load()
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('AppShell', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders brand title and navigation links', async () => {
    await renderShellAt('/new')

    expect(screen.getByText('PS Store')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upcoming' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Discounted' })).toBeInTheDocument()
  })

  it('renders a search input with the agreed a11y attributes', async () => {
    await renderShellAt('/new')

    const input = screen.getByRole('searchbox', { name: 'Search' })
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Search')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })

  it('passes the typed query to sibling routes via context', async () => {
    await renderShellAt('/new')

    const input = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'silksong' } })

    expect(screen.getByTestId('probe-query')).toHaveTextContent('silksong')
  })

  it('clears the query when the route changes', async () => {
    await renderShellAt('/new')

    const input = screen.getByRole<HTMLInputElement>('searchbox', {
      name: 'Search',
    })
    fireEvent.change(input, { target: { value: 'silksong' } })
    expect(input.value).toBe('silksong')

    fireEvent.click(screen.getByRole('link', { name: 'Discounted' }))

    expect(
      screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' }).value,
    ).toBe('')
    expect(screen.getByTestId('probe-query')).toHaveTextContent('')
  })
})
