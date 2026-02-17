import { filterGamesByGenre, type Game as GameObject } from '@psstore/shared'
import { Fragment, useEffect, useMemo, useState } from 'react'
import DateHeader from './DateHeader'
import Error from './Error'
import Game from './Game'
import Navigation from './Navigation'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

interface GamesProps {
  label: string
  fetch: () => Promise<GameObject[]>
  showNavigation?: boolean
}

const Games = ({ label, fetch, showNavigation = true }: GamesProps) => {
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
    return (
      <Fragment>
        {showNavigation && <Navigation />}
        <Error />
      </Fragment>
    )
  }

  if (loading) {
    return (
      <Fragment>
        {showNavigation && <Navigation />}
        <Loading loading={loading} />
      </Fragment>
    )
  }

  if (filteredGames.length === 0) {
    return (
      <Fragment>
        {showNavigation && <Navigation />}
        <Error message="No games found" />
      </Fragment>
    )
  }

  const genreList = Array.from(new Set(games.flatMap((g) => g.genres))).sort()

  return (
    <Fragment>
      <ScrollToTopOnMount />
      {showNavigation && <Navigation />}
      <div className="games--content">
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

        {filteredGames.map(({ date, discountDate, id, name, url }, index) => {
          const dateTime = label === 'discounted' ? discountDate : date
          const previousDate =
            index > 0
              ? label === 'discounted'
                ? filteredGames[index - 1]?.discountDate
                : filteredGames[index - 1]?.date
              : ''
          const showDateHeader = dateTime !== previousDate

          return (
            <Fragment key={id}>
              {showDateHeader && <DateHeader date={dateTime} />}
              <Game id={id} name={name} url={url} />
            </Fragment>
          )
        })}
      </div>
    </Fragment>
  )
}

export default Games
