import type { Game } from '@psstore/shared'
import { useEffect, useRef, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import {
  consumeFocusReturn,
  useFocusReturn,
  viewKeyFor,
} from '../modules/focusReturn'
import GameCard from './GameCard'
import Spinner from './Spinner'

interface GameGridProps {
  games: readonly Game[]
  label: string
  showPrice?: boolean
  internalLink?: boolean
  trailing?: ReactNode
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
}

// A card grid plus a sentinel that asks for the next page when it scrolls into
// view.
const GameGrid = ({
  games,
  label,
  showPrice = true,
  internalLink = false,
  trailing = null,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: GameGridProps) => {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const focusReturn = useFocusReturn()
  const viewKey = useRouterState({
    select: (state) =>
      viewKeyFor(state.location.pathname, state.location.search),
  })

  // Runs on the first render of the grid only: a later change of the list must
  // not pull focus.
  useEffect(() => {
    if (focusReturn !== null && gridRef.current !== null) {
      consumeFocusReturn(focusReturn, viewKey, gridRef.current)
    }
  }, [])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <>
      <div className="games--content">
        <div ref={gridRef} className="games--grid" data-label={label}>
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              showPrice={showPrice}
              internalLink={internalLink}
            />
          ))}
          {trailing}
        </div>
        <div ref={sentinelRef} className="games--sentinel">
          {isFetchingNextPage && <Spinner />}
        </div>
      </div>
    </>
  )
}

export default GameGrid
