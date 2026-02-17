import type { Game as GameObject, PageResult } from '@psstore/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGameDate } from '../modules/psnStore'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

const PAGE_SIZE = 60
const DATE_CONCURRENCY = 6

const enrichDates = (
  gameIds: string[],
  onDate: (id: string, date: string) => void,
  signal: AbortSignal,
): void => {
  let nextIndex = 0

  const processNext = async (): Promise<void> => {
    while (nextIndex < gameIds.length) {
      if (signal.aborted) return
      const id = gameIds[nextIndex]
      nextIndex += 1

      try {
        const date = await fetchGameDate(id)
        if (!signal.aborted && date) {
          onDate(id, date)
        }
      } catch {
        // silently skip failed lookups
      }
    }
  }

  const workers = Math.min(DATE_CONCURRENCY, gameIds.length)
  for (let i = 0; i < workers; i++) {
    processNext()
  }
}

interface GamesProps {
  label: string
  fetch: (offset: number, size: number) => Promise<PageResult>
  emptyMessage?: string
}

const Games = ({ label, fetch, emptyMessage = 'No games found' }: GamesProps) => {
  const [games, setGames] = useState<GameObject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const enrichedIdsRef = useRef(new Set<string>())

  const handleDateResolved = useCallback((id: string, date: string) => {
    setGames((prev) =>
      prev.map((game) => (game.id === id ? { ...game, date } : game)),
    )
  }, [])

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      try {
        const result = await fetch(offset, PAGE_SIZE)
        setGames((prev) => (append ? [...prev, ...result.games] : result.games))
        setNextOffset(result.nextOffset)

        // Kick off date enrichment for new game IDs
        const newIds = result.games
          .map((g) => g.id)
          .filter((id) => id && !enrichedIdsRef.current.has(id))
        for (const id of newIds) {
          enrichedIdsRef.current.add(id)
        }

        if (newIds.length > 0) {
          const controller = new AbortController()
          enrichDates(newIds, handleDateResolved, controller.signal)
        }
      } catch {
        if (!append) {
          setError(true)
        }
      } finally {
        if (append) {
          setLoadingMore(false)
        } else {
          setLoading(false)
        }
      }
    },
    [fetch, handleDateResolved],
  )

  useEffect(() => {
    setGames([])
    setNextOffset(null)
    setError(false)
    enrichedIdsRef.current = new Set()
    loadPage(0, false)
  }, [loadPage])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextOffset !== null && !loadingMore) {
          loadPage(nextOffset, true)
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [nextOffset, loadingMore, loadPage])

  if (error) {
    return <Error message="Failed to load games" />
  }

  if (loading) {
    return <Loading loading={loading} />
  }

  if (games.length === 0) {
    return <Error message={emptyMessage} />
  }

  return (
    <>
      <ScrollToTopOnMount />
      <div className="games--content">
        <div className="games--grid" data-label={label}>
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
        <div ref={sentinelRef} className="games--sentinel">
          {loadingMore && <Loading loading />}
        </div>
      </div>
    </>
  )
}

export default Games
