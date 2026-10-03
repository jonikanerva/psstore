import type { Game } from '@psstore/shared'
import { useEffect, useRef, type ReactNode } from 'react'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Spinner from './Spinner'

interface GameGridProps {
  games: readonly Game[]
  label: string
  showPrice?: boolean
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
  trailing = null,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: GameGridProps) => {
  const sentinelRef = useRef<HTMLDivElement>(null)

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
      <ScrollToTopOnMount />
      <div className="games--content">
        <div className="games--grid" data-label={label}>
          {games.map((game) => (
            <GameCard key={game.id} game={game} showPrice={showPrice} />
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
