import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from '../components/AppShell'

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

    expect(screen.getByText('PS5 Catalog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upcoming' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Discounted' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plus' })).toBeInTheDocument()
  })
})
