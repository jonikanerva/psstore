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
  const wishlistRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'wishlist',
    component: QueryProbe,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      newRoute,
      upcomingRoute,
      discountedRoute,
      purchasedRoute,
      searchRoute,
      wishlistRoute,
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
    ).toEqual([
      'New',
      'Upcoming',
      'Discounted',
      'Monthly',
      'Wishlist',
      'Purchased',
    ])
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

  describe('sort bar', () => {
    const pillNames = () =>
      within(screen.getByRole('group', { name: 'Sort' }))
        .getAllByRole('button')
        .map((button) => button.textContent)

    it('offers the fields of the current route', async () => {
      await renderShellAt('/upcoming')
      expect(pillNames()).toEqual(['Default', 'Date', 'Name'])
      cleanup()

      await renderShellAt('/discounted')
      expect(pillNames()).toEqual(['Default', 'Date', 'Price', 'Name'])
    })

    it('is hidden on the search route', async () => {
      await renderShellAt('/search')
      expect(
        screen.queryByRole('group', { name: 'Sort' }),
      ).not.toBeInTheDocument()
    })

    it('is hidden on PURCHASED until the library list exists', async () => {
      await renderShellAt('/purchased')
      expect(
        screen.queryByRole('group', { name: 'Sort' }),
      ).not.toBeInTheDocument()
    })

    it('starts with only the Default pill pressed', async () => {
      await renderShellAt('/discounted')
      const buttons = within(
        screen.getByRole('group', { name: 'Sort' }),
      ).getAllByRole('button')
      expect(
        buttons.map((button) => button.getAttribute('aria-pressed')),
      ).toEqual(['true', 'false', 'false', 'false'])
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('default')
    })

    it('activates a pill at its natural direction in one click', async () => {
      await renderShellAt('/discounted')
      fireEvent.click(screen.getByRole('button', { name: 'Sort by price' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('price asc')
      cleanup()

      await renderShellAt('/discounted')
      fireEvent.click(screen.getByRole('button', { name: 'Sort by date' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('date desc')
    })

    it('flips between two directions, and Default restores the order', async () => {
      await renderShellAt('/upcoming')
      fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
      const pill = screen.getByRole('button', {
        name: 'Sort by name, ascending',
      })
      expect(pill).toHaveAttribute('aria-pressed', 'true')
      expect(pill).toHaveTextContent('Name ↑')

      fireEvent.click(pill)
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('name desc')
      const flipped = screen.getByRole('button', {
        name: 'Sort by name, descending',
      })
      expect(flipped).toHaveTextContent('Name ↓')

      fireEvent.click(flipped)
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('name asc')

      fireEvent.click(screen.getByRole('button', { name: 'Default' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('default')
      expect(screen.getByRole('button', { name: 'Default' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(
        screen.getByRole('button', { name: 'Sort by name' }),
      ).toHaveAttribute('aria-pressed', 'false')
    })

    it('moves the sort to another pill', async () => {
      await renderShellAt('/upcoming')
      fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sort by date' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('date desc')
      expect(
        screen.getByRole('button', { name: 'Sort by name' }),
      ).toHaveAttribute('aria-pressed', 'false')
    })

    it('resets when the route changes, also when coming back', async () => {
      await renderShellAt('/upcoming')
      fireEvent.click(screen.getByRole('button', { name: 'Sort by date' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('date desc')

      fireEvent.click(screen.getByRole('link', { name: 'Discounted' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('default')
      expect(
        screen.getByRole('button', { name: 'Sort by date' }),
      ).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(screen.getByRole('link', { name: 'Upcoming' }))
      expect(screen.getByTestId('probe-sort')).toHaveTextContent('default')
    })
  })

  it('disables the search on WISHLIST until the wishlist exists', async () => {
    await renderShellAt('/wishlist')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeDisabled()
  })

  it('renders six anchor links with Purchased last', async () => {
    await renderShellAt('/new')
    const nav = screen.getByRole('navigation', { name: 'Top navigation' })
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(6)
    for (const link of links) {
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href')
    }
    expect(links.at(-2)).toHaveTextContent('Wishlist')
    expect(links.at(-1)).toHaveTextContent('Purchased')
  })
})
