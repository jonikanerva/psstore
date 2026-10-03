import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Details from '../components/Details'
import { renderRoutes } from './testRouter'

vi.mock('../components/GameDetailsPage', () => ({
  default: () => <article>Game page</article>,
}))

const routes = {
  '/discounted': () => <div>List</div>,
  '/new': () => <div>New list</div>,
  '/g/$gameId': Details,
}

// Opens the game page from a tab with the origin state a GameCard sets.
const openFromTab = async () => {
  const router = await renderRoutes(routes, ['/discounted'])
  act(() => {
    router.history.push('/g/abc', { pdpOrigin: '/discounted' })
  })
  await screen.findByText('Game page')
  return router
}

const pressEscape = (init: KeyboardEventInit = {}, target?: Element) => {
  fireEvent.keyDown(target ?? document.body, { key: 'Escape', ...init })
}

describe('Details close', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('goes back in history with the X button when an origin exists', async () => {
    const router = await openFromTab()
    const back = vi.spyOn(router.history, 'back')
    fireEvent.click(screen.getByRole('button', { name: 'Close game page' }))
    expect(back).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/discounted')
    })
  })

  it('opens NEW on direct entry', async () => {
    const router = await renderRoutes(routes, ['/g/abc'])
    await screen.findByText('Game page')
    fireEvent.click(screen.getByRole('button', { name: 'Close game page' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/new')
    })
  })

  it('opens the origin tab when it has origin state but no back entry', async () => {
    const router = await renderRoutes(routes, ['/g/abc'])
    await screen.findByText('Game page')
    act(() => {
      router.history.replace('/g/abc', { pdpOrigin: '/discounted' })
    })
    expect(router.history.canGoBack()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close game page' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/discounted')
    })
  })

  it('opens NEW for a search origin with no back entry', async () => {
    const router = await renderRoutes(routes, ['/g/abc'])
    await screen.findByText('Game page')
    act(() => {
      router.history.replace('/g/abc', { pdpOrigin: '/search' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close game page' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/new')
    })
  })

  it('closes on Escape', async () => {
    const router = await openFromTab()
    pressEscape()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/discounted')
    })
  })

  it('ignores Escape with an open dialog', async () => {
    const router = await openFromTab()
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    pressEscape()
    expect(router.state.location.pathname).toBe('/g/abc')
  })

  it('ignores Escape typed in a text field', async () => {
    const router = await openFromTab()
    const input = document.createElement('input')
    document.body.append(input)
    pressEscape({}, input)
    expect(router.state.location.pathname).toBe('/g/abc')
  })

  it('ignores a key event that another handler already handled', async () => {
    const router = await openFromTab()
    const handled = (event: KeyboardEvent) => {
      event.preventDefault()
    }
    document.body.addEventListener('keydown', handled)
    pressEscape()
    document.body.removeEventListener('keydown', handled)
    expect(router.state.location.pathname).toBe('/g/abc')
  })

  it.each([{ repeat: true }, { shiftKey: true }, { ctrlKey: true }])(
    'ignores Escape with %j',
    async (init) => {
      const router = await openFromTab()
      pressEscape(init)
      expect(router.state.location.pathname).toBe('/g/abc')
    },
  )

  it('removes the Escape listener on unmount', async () => {
    await openFromTab()
    const remove = vi.spyOn(document, 'removeEventListener')
    cleanup()
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('labels the X button as a native button', async () => {
    await openFromTab()
    const button = screen.getByRole('button', { name: 'Close game page' })
    expect(button).toHaveAttribute('type', 'button')
  })
})
