import * as R from 'ramda'
import { useEffect, useState, Fragment } from 'react'
import { Game as GameObject } from '../modules/psnStore'
import DateHeader from './DateHeader'
import Error from './Error'
import Game from './Game'
import Navigation from './Navigation'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Games.css'

const isEmpty = R.either(R.isEmpty, R.isNil)

interface GamesProps {
  label: string
  fetch: () => Promise<GameObject[]>
}

const Games = ({ label, fetch }: GamesProps) => {
  const [games, setGames] = useState<GameObject[]>([])
  const [filteredGames, setFilteredGames] = useState<GameObject[]>([])
  const [filter, setFilter] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const hasGames = !isEmpty(games)
  const filterGames = (filter?: string) => (): void => setFilter(filter)

  useEffect(() => {
    fetch()
      .then((gamesResponse) => {
        setGames(gamesResponse)
        setFilteredGames(gamesResponse)
      })
      .then(() => setLoading(false))
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [fetch])

  useEffect(() => {
    if (!games) {
      return
    }

    const filtered =
      filter === undefined
        ? games
        : games.filter(({ genres }) => R.includes(filter, genres))

    setFilter(filter)
    setFilteredGames(filtered)
  }, [filter, games])

  if (error) {
    return (
      <Fragment>
        <Navigation />
        <Error />
      </Fragment>
    )
  }

  if (loading) {
    return (
      <Fragment>
        <Navigation />
        <Loading loading={loading} />
      </Fragment>
    )
  }

  if (!loading && !hasGames) {
    return (
      <Fragment>
        <Navigation />
        <Error message="No games found" />
      </Fragment>
    )
  }

  const allSelected = !filter ? 'games--selected' : ''
  const genreList = Array.from(new Set(games.flatMap((g) => g.genres))).sort()

  return (
    <Fragment>
      <ScrollToTopOnMount />
      <Navigation />
      <div className="games--content">
        <div className="games--filter-navi">
          <div
            className={`games--filter-name ${allSelected}`}
            onClick={filterGames()}
          >
            All
          </div>

          {genreList.map((genre: string) => {
            const selectedClass = genre === filter ? 'games--selected' : ''
            return (
              <div
                key={genre}
                className={`games--filter-name ${selectedClass}`}
                onClick={filterGames(genre)}
              >
                {genre}
              </div>
            )
          })}
        </div>

        {filteredGames.map(({ date, discountDate, id, name, url }) => {
          const dateTime = label === 'discounted' ? discountDate : date

          return (
            <Fragment key={id}>
              <DateHeader date={dateTime} />
              <Game id={id} name={name} url={url} />
            </Fragment>
          )
        })}
      </div>
    </Fragment>
  )
}

export default Games
