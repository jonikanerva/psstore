import { filterGamesByGenre, type Game as GameObject } from '@psstore/shared'
import { useEffect, useMemo, useState } from 'react'
import Error from './Error'
import GameCard from './GameCard'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

interface GamesProps {
  label: string
  fetch: () => Promise<GameObject[]>
  showFilters?: boolean
  emptyMessage?: string
}

const Games = ({ label, fetch, showFilters = true, emptyMessage = 'No games found' }: GamesProps) => {
  const [games, setGames] = useState<GameObject[]>([])
  const [filter, setFilter] = useState<string>('')
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

  const filteredGames = useMemo(() => filterGamesByGenre(games, filter || undefined), [games, filter])

  if (error) {
    return <Error message="Failed to load games" />
  }

  if (loading) {
    return <Loading loading={loading} />
  }

  if (filteredGames.length === 0) {
    return <Error message={emptyMessage} />
  }

  const genreList = Array.from(new Set(games.flatMap((g) => g.genres))).sort()

  return (
    <>
      <ScrollToTopOnMount />
      <div className="games--content">
        {showFilters && (
          <div className="games--filter-navi" aria-label="Game genre filters">
            <button
              type="button"
              className={`games--filter-name ${!filter ? 'games--selected' : ''}`}
              onClick={() => setFilter('')}
            >
              All
            </button>
            {genreList.map((genre) => (
              <button
                key={genre}
                type="button"
                className={`games--filter-name ${genre === filter ? 'games--selected' : ''}`}
                onClick={() => setFilter(genre)}
              >
                {genre}
              </button>
            ))}
          </div>
        )}
        <div className="games--grid" data-label={label}>
          {filteredGames.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </div>
    </>
  )
}

export default Games
