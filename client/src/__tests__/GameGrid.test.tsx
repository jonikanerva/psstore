import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '@psstore/shared'
import GameGrid from '../components/GameGrid'
import { renderWithRouter } from './testRouter'

let trigger: (intersecting: boolean) => void = () => undefined
let disconnected = 0

beforeEach(() => {
  disconnected = 0
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        trigger = (isIntersecting) => {
          callback([{ isIntersecting }])
        }
      }
      observe = vi.fn()
      disconnect = () => {
        disconnected += 1
      }
    },
  )
})

afterEach(() => {
  cleanup()
})

const game = (id: string, name: string): Game => ({
  id,
  name,
  date: '',
  url: 'https://example.com/cover.png',
  price: '€9,99',
  originalPrice: '',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind: 'product',
})

const grid = (props: {
  hasNextPage: boolean
  isFetchingNextPage?: boolean
  fetchNextPage: () => unknown
}) => (
  <GameGrid
    games={[game('EP1-A', 'Alpha'), game('EP1-B', 'Beta')]}
    label="test"
    isFetchingNextPage={false}
    {...props}
  />
)

describe('GameGrid', () => {
  it('renders one card per game under the given label', async () => {
    const { container } = await renderWithRouter(
      grid({ hasNextPage: false, fetchNextPage: vi.fn() }),
    )

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(container.querySelector('[data-label="test"]')).not.toBeNull()
  })

  it('asks for the next page when the sentinel is visible', async () => {
    const fetchNextPage = vi.fn()
    await renderWithRouter(grid({ hasNextPage: true, fetchNextPage }))

    trigger(true)

    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it('does nothing when the sentinel is not visible', async () => {
    const fetchNextPage = vi.fn()
    await renderWithRouter(grid({ hasNextPage: true, fetchNextPage }))

    trigger(false)

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('does not ask past the last page or while a page loads', async () => {
    const last = vi.fn()
    const loading = vi.fn()
    const first = await renderWithRouter(
      grid({ hasNextPage: false, fetchNextPage: last }),
    )
    trigger(true)
    first.unmount()
    await renderWithRouter(
      grid({
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage: loading,
      }),
    )
    trigger(true)

    expect(last).not.toHaveBeenCalled()
    expect(loading).not.toHaveBeenCalled()
  })

  it('stops observing when it unmounts', async () => {
    const view = await renderWithRouter(
      grid({ hasNextPage: true, fetchNextPage: vi.fn() }),
    )
    const before = disconnected

    view.unmount()

    expect(disconnected).toBeGreaterThan(before)
  })
})
