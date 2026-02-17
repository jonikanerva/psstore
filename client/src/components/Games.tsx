import type { Game as GameObject } from '@psstore/shared'
import { useEffect, useState } from 'react'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

interface GamesProps {
  label: string
  fetch: () => Promise<GameObject[]>
  emptyMessage?: string
}

const Games = ({ label, fetch, emptyMessage = 'No games found' }: GamesProps) => {
  const [games, setGames] = useState<GameObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch()
      .then((gamesResponse) => {
        if (!cancelled) {
          setGames(gamesResponse)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [fetch])

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
      </div>
    </>
  )
}

export default Games
