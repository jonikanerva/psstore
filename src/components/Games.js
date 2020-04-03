import * as R from 'ramda'
import React, { useEffect, useState } from 'react'
import Error from './Error'
import Game from './Game'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import Navigation from './Navigation'
import DateHeader from './DateHeader'

import './Games.css'

const isEmpty = R.either(R.isEmpty, R.isNil)

const Games = ({ label, fetch }) => {
  const [games, setGames] = useState(null)
  const [filteredGames, setFilteredGames] = useState(null)
  const [filter, setFilter] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const hasGames = !isEmpty(games)
  const filterGames = (filter) => () => setFilter(filter)

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
          <div
            className={`games--filterName ${allSelected}`}
            onClick={filterGames()}
          >
            All
          </div>

          {genreList.map((genre) => {
            const selectedClass = genre === filter ? 'games--selected' : ''
            return (
              <div
                key={genre}
                className={`games--filterName ${selectedClass}`}
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
