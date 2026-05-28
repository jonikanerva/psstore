import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell, { type SearchContext } from '../components/AppShell'

const QueryProbe = () => {
  const { query } = useOutletContext<SearchContext>()
  return <div data-testid="probe-query">{query}</div>
}

const renderShellAt = (initialEntries: string[]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/new" element={<QueryProbe />} />
          <Route path="/discounted" element={<QueryProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

describe('AppShell', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders brand title and navigation links', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )

    expect(screen.getByText('PS Store')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upcoming' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Discounted' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plus' })).toBeInTheDocument()
  })

  it('renders a search input with the agreed a11y attributes', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )

    const input = screen.getByRole('searchbox', { name: 'Search' })
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Search')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })

  it('passes the typed query to sibling routes via Outlet context', () => {
    renderShellAt(['/new'])

    const input = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'silksong' } })

    expect(screen.getByTestId('probe-query')).toHaveTextContent('silksong')
  })

  it('clears the query when the route changes', () => {
    renderShellAt(['/new'])

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
