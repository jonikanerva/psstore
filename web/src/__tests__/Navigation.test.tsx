import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Navigation from '../components/Navigation'
import { renderRoutes } from './testRouter'

const routes = {
  '/discounted': Navigation,
  '/g/$gameId': Navigation,
}

describe('Navigation origin highlight', () => {
  afterEach(cleanup)

  it('highlights the active tab', async () => {
    await renderRoutes(routes, ['/discounted'])
    expect(screen.getByRole('link', { name: 'Discounted' })).toHaveClass(
      'navigation--active',
    )
  })

  it('highlights the origin tab on a game page, without aria-current', async () => {
    const router = await renderRoutes(routes, ['/discounted'])
    act(() => {
      router.history.push('/g/abc', { pdpOrigin: '/discounted' })
    })
    const origin = screen.getByRole('link', { name: 'Discounted' })
    expect(origin).toHaveClass('navigation--origin')
    expect(origin).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'New' })).not.toHaveClass(
      'navigation--origin',
    )
  })

  it('highlights no tab on a game page without origin state', async () => {
    await renderRoutes(routes, ['/g/abc'])
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveClass('navigation--origin')
      expect(link).not.toHaveClass('navigation--active')
    }
  })
})
