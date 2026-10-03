import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from '../components/AppShell'
import { useSearchQuery } from '../modules/searchContext'
import { useSort } from '../modules/sortContext'

const QueryProbe = () => {
  const query = useSearchQuery()
  const sort = useSort()
  return (
    <>
      <div data-testid="probe-query">{query}</div>
      <div data-testid="probe-sort">
        {sort === null ? 'default' : `${sort.field} ${sort.direction}`}
      </div>
    </>
  )
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
  const purchasedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'purchased',
    component: QueryProbe,
  })
  const upcomingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'upcoming',
    component: QueryProbe,
  })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'search',
    component: QueryProbe,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      newRoute,
      upcomingRoute,
      discountedRoute,
      purchasedRoute,
      searchRoute,
    ]),
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
    expect(screen.getByRole('link', { name: 'Monthly' })).toBeInTheDocument()
  })

  it('lists the views in the agreed order', async () => {
    await renderShellAt('/new')

    const nav = screen.getByRole('navigation', { name: 'Top navigation' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['New', 'Upcoming', 'Discounted', 'Monthly', 'Purchased'])
  })

  it('marks the current view with aria-current', async () => {
    await renderShellAt('/new')

    expect(screen.getByRole('link', { name: 'New' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Monthly' })).not.toHaveAttribute(
      'aria-current',
    )
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

  it('disables the search on PURCHASED until the library list exists', async () => {
    await renderShellAt('/purchased')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeDisabled()
    cleanup()

    await renderShellAt('/new')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeEnabled()
  })

  describe('sort control', () => {
    const optionLabels = () =>
      within(screen.getByRole('combobox', { name: 'Sort by' }))
        .getAllByRole('option')
        .map((option) => option.textContent)

    it('offers the fields of the current route', async () => {
      await renderShellAt('/upcoming')
      expect(optionLabels()).toEqual(['Default', 'Release date', 'Name'])
      cleanup()

      await renderShellAt('/discounted')
      expect(optionLabels()).toEqual([
        'Default',
        'Release date',
        'Price',
        'Name',
      ])
    })

    it('is hidden on the search route', async () => {
      await renderShellAt('/search')
      expect(
        screen.queryByRole('combobox', { name: 'Sort by' }),
      ).not.toBeInTheDocument()
    })

    it('is hidden on PURCHASED until the library list exists', async () => {
      await renderShellAt('/purchased')
      expect(
        screen.queryByRole('combobox', { name: 'Sort by' }),
      ).not.toBeInTheDocument()
    })

    it('disables the direction button while Default is chosen', async () => {
      await renderShellAt('/upcoming')
      expect(
        screen.getByRole('button', { name: 'Sort direction' }),
      ).toBeDisabled()
    })

    it('starts at the natural direction and toggles it', async () => {
      await renderShellAt('/upcoming')
      fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
        target: { value: 'name' },
      })
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('name asc')
      const button = screen.getByRole('button', {
        name: 'Sort direction: ascending',
      })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('aria-pressed')

      fireEvent.click(button)

      expect(screen.getByTestId('probe-sort')).toHaveTextContent('name desc')
      expect(
        screen.getByRole('button', { name: 'Sort direction: descending' }),
      ).toBeInTheDocument()
    })

    it('resets when the route changes, also when coming back', async () => {
      await renderShellAt('/upcoming')
      fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
        target: { value: 'date' },
      })
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('date desc')

      fireEvent.click(screen.getByRole('link', { name: 'Discounted' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('default')
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sort by' })
          .value,
      ).toBe('')

      fireEvent.click(screen.getByRole('link', { name: 'Upcoming' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('default')
    })
  })
})
