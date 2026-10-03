import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from '../components/AppShell'
import {
  parseSearch,
  readSearchTerm,
  stringifySearch,
} from '../modules/searchTerm'
import { useSearchQuery } from '../modules/searchContext'

const Probe = () => <div data-testid="filter">{useSearchQuery()}</div>

const renderAt = async (initial: string) => {
  const rootRoute = createRootRoute({ component: AppShell })
  const view = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: Probe,
    })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'search',
    validateSearch: (search: Record<string, unknown>) => ({
      q: readSearchTerm(search),
    }),
    component: () => <div data-testid="search-page">search page</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      view('new'),
      view('discounted'),
      searchRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    parseSearch,
    stringifySearch,
  })
  await router.load()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const field = () =>
  screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' })

const type = (value: string) => {
  fireEvent.change(field(), { target: { value } })
}

const submit = () => {
  fireEvent.submit(screen.getByRole('search'))
}

afterEach(() => {
  cleanup()
})

describe('AppShell global search', () => {
  it('wraps the field in a search form', async () => {
    await renderAt('/new')

    expect(screen.getByRole('search')).toContainElement(field())
    expect(field()).toHaveAttribute('maxlength', '100')
  })

  it('keeps the header unchanged while typing and searching', async () => {
    await renderAt('/new')
    const header = screen.getByRole('banner')
    const before = header.innerHTML.replace(/value="[^"]*"/, '')

    type('elden')

    expect(header.innerHTML.replace(/value="[^"]*"/, '')).toBe(before)
    expect(screen.queryByRole('link', { name: /Search all/ })).toBeNull()
    expect(screen.getByTestId('filter')).toHaveTextContent('elden')
  })

  it('submits to the search route on Enter', async () => {
    const router = await renderAt('/new')

    type('  elden  ')
    await act(async () => {
      submit()
      await router.load()
    })

    expect(router.state.location.pathname).toBe('/search')
    expect(router.state.location.search).toEqual({ q: 'elden' })
    expect(await screen.findByTestId('search-page')).toBeInTheDocument()
  })

  it('does nothing on submit of an empty or whitespace term', async () => {
    const router = await renderAt('/new')

    submit()
    type('   ')
    submit()

    expect(router.state.location.pathname).toBe('/new')
  })

  it('hides the row on the search route and seeds the field from q', async () => {
    await renderAt('/search?q=god%20of%20war')

    expect(field().value).toBe('god of war')
    expect(screen.queryByRole('link', { name: /Search all/ })).toBeNull()
  })

  it('edits on the search route only change the field', async () => {
    const router = await renderAt('/search?q=elden')

    type('bloodborne')

    expect(field().value).toBe('bloodborne')
    expect(router.state.location.search).toEqual({ q: 'elden' })
    expect(screen.queryByRole('link', { name: /Search all/ })).toBeNull()
  })

  it('submits a new term from the search route', async () => {
    const router = await renderAt('/search?q=elden')

    type('bloodborne')
    await act(async () => {
      submit()
      await router.load()
    })

    expect(router.state.location.search).toEqual({ q: 'bloodborne' })
  })

  it('has no active navigation tab on the search route', async () => {
    await renderAt('/search?q=elden')

    for (const name of ['New', 'Upcoming', 'Discounted', 'Monthly']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute(
        'aria-current',
      )
    }
  })

  it('clears the field when leaving the search route', async () => {
    await renderAt('/search?q=elden')

    fireEvent.click(screen.getByRole('link', { name: 'Discounted' }))

    expect(await screen.findByTestId('filter')).toHaveTextContent('')
    expect(field().value).toBe('')
  })

  it('caps an over-long term at 100 characters in the URL', async () => {
    const router = await renderAt('/new')
    const long = 'a'.repeat(120)

    type(long)
    await act(async () => {
      submit()
      await router.load()
    })

    expect(readSearchTerm(router.state.location.search)).toBe('a'.repeat(100))
  })

  it('keeps a numeric-looking term a string through the URL', async () => {
    const router = await renderAt('/new')

    type('2077')
    await act(async () => {
      submit()
      await router.load()
    })

    expect(router.state.location.search).toEqual({ q: '2077' })
    expect(field().value).toBe('2077')
  })

  it('restores the earlier term when the user goes back', async () => {
    const router = await renderAt('/search?q=elden')

    type('bloodborne')
    await act(async () => {
      submit()
      await router.load()
    })
    expect(field().value).toBe('bloodborne')

    await act(async () => {
      router.history.back()
      await router.load()
    })

    expect(router.state.location.search).toEqual({ q: 'elden' })
    expect(field().value).toBe('elden')
  })
})
