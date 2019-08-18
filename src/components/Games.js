import * as R from 'ramda'
import React, { useEffect, useState } from 'react'
import Error from './Error'
import Game from './Game'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import Navigation from './Navigation'

import './Games.css'

const isEmpty = R.either(R.isEmpty, R.isNil)

const Games = ({ label, fetch }) => {
  const [games, setGames] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const hasGames = !isEmpty(games)

  useEffect(() => {
    fetch()
      .then(setGames)
      .then(() => setLoading(false))
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [fetch])

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

  return (
    <React.Fragment>
      <ScrollToTopOnMount />
      <Navigation />
      <div className="games--content">
        {games.map(game => (
          <Game label={label} game={game} key={game.id} />
        ))}
      </div>
    </React.Fragment>
  )
}

export default Games
