import type { PageResult } from '@psstore/shared'
import { filterGamesByName } from '@psstore/shared'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useSearchQuery } from '../modules/searchContext'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'

const PAGE_SIZE = 60

interface GamesProps {
  feature: 'new' | 'upcoming' | 'discounted'
  fetch: (offset: number, size: number) => Promise<PageResult>
  emptyMessage?: string
}

const Games = ({
  feature,
  fetch,
  emptyMessage = 'No games found',
}: GamesProps) => {
  const query = useSearchQuery()
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Query key is feature only (pagination flows through pageParam); the search
  // text is never part of the key, so the persisted cache carries no search or
  // behaviour state (da #4, ux condition 1). useInfiniteQuery accumulates pages
  // and preserves the previous append-vs-replace + nextOffset semantics: each
  // page's `nextOffset` becomes the next pageParam, or undefined to stop.
  const {
    data,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['games', feature],
    queryFn: ({ pageParam }) => fetch(pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  })

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

  if (isError) {
    return <Error message="Failed to load games" />
  }

  if (isPending) {
    return <Loading loading />
  }

  const games = data.pages.flatMap((page) => page.games)
  const filtered = filterGamesByName(games, query)

  if (filtered.length === 0) {
    return <Error message={emptyMessage} />
  }

  return (
    <>
      <ScrollToTopOnMount />
      <div className="games--content">
        <div className="games--grid" data-label={feature}>
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
        <div ref={sentinelRef} className="games--sentinel">
          {isFetchingNextPage && <Loading loading />}
        </div>
      </div>
    </>
  )
}

export default Games
