import * as R from 'ramda'
import React, { useEffect, useState } from 'react'
import queryString from 'query-string'
import Error from './Error'
import Game from './Game'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import Navigation from './Navigation'
import DateHeader from './DateHeader'

import './Games.css'

const isEmpty = R.either(R.isEmpty, R.isNil)

const Games = ({ label, fetch, location }) => {
  const [games, setGames] = useState(null)
  const [filteredGames, setFilteredGames] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const hasGames = !isEmpty(games)
  const search = R.prop('search', location)
  const { filter } = queryString.parse(search)

  useEffect(() => {
    fetch()
      .then(setGames)
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

    const filteredGames = games.filter(({ genres }) =>
      R.includes(filter, genres)
    )
    setFilteredGames(filteredGames)
  }, [games, filter])

  const gameList = R.isEmpty(filteredGames) ? games : filteredGames

  if (error) {
    return (
      <React.Fragment>
        <Navigation />
        <Error />
      </React.Fragment>
    )
  }

  if (loading) {
    return (
      <React.Fragment>
        <Navigation />
        <Loading loading={loading} />
      </React.Fragment>
    )
  }

  if (!loading && !hasGames) {
    return (
      <React.Fragment>
        <Navigation />
        <Error message="No games found" />
      </React.Fragment>
    )
  }

  const allSelected = !filter ? 'games--selected' : ''
  const genreList = R.compose(
    (array) => array.sort(),
    R.uniq,
    R.chain(R.prop('genres'))
  )(games)

  return (
    <React.Fragment>
      <ScrollToTopOnMount />
      <Navigation />
      <div className="games--content">
        <div className="games--filterNavi">
          <div className="games--filterName">
            <a className={allSelected} href={location.pathname}>
              All
            </a>
          </div>

          {genreList.map((genre) => {
            const selectedClass = genre === filter ? 'games--selected' : ''
            return (
              <div key={genre} className="games--filterName">
                <a
                  className={selectedClass}
                  href={`${location.pathname}?filter=${genre}`}
                >
                  {genre}
                </a>
              </div>
            )
          })}
        </div>

        {gameList.map(({ date, discountDate, id, name, url }) => {
          const dateTime = label === 'discounted' ? discountDate : date

          return (
            <React.Fragment key={id}>
              <DateHeader date={dateTime} />
              <Game id={id} name={name} url={url} />
            </React.Fragment>
          )
        })}
      </div>
    </React.Fragment>
  )
}

export default Games
