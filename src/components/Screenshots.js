import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import * as R from 'ramda'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Error from './Error'

import './Screenshots.css'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`

const Name = ({ name }) => <div className="screenshots--name">{name}</div>

const ByLine = ({ genres, studio }) => (
  <div className="screenshots--byline">
    {genres} by {studio}
  </div>
)

const Buy = ({ id }) => (
  <a className="screenshots--buy" href={storeUrl(id)}>
    BUY
  </a>
)

const Images = ({ screenshots, name }) =>
  screenshots.map((screenshot, i) => (
    <Link to="/" key={i}>
      <img src={screenshot} alt={name} className="screenshots__image" />
    </Link>
  ))

const Videos = ({ videos }) =>
  videos.map((video, i) => (
    <video preload="metadata" controls muted width="100%" src={video} key={i} />
  ))

const Description = ({ description }) => (
  <div
    className="screenshots--description"
    dangerouslySetInnerHTML={{ __html: description }}
  />
)

const findGame = (gameId, games) =>
  R.compose(
    R.find(R.propEq('id', gameId)),
    R.reject(R.isNil),
    R.flatten,
    R.props(['newGames', 'discountedGames', 'upcomingGames', 'searchGames'])
  )(games)

const Screenshots = props => {
  const gameId = props.match.params.gameId
  const games = props.games
  const game = findGame(gameId, games)

  if (!game) {
    return <Error />
  }

  const { id, description, genres, name, screenshots, studio, videos } = game

  return (
    <div className="screenshots">
      <ScrollToTopOnMount />
      <div className="screenshots__top">
        <div className="screenshots__top-left">
          <Name name={name} />
          <ByLine genres={genres} studio={studio} />
        </div>
        <div className="screenshots__top-right">
          <Buy id={id} />
        </div>
      </div>
      <Images screenshots={screenshots} name={name} />
      <Videos videos={videos} />
      <Description description={description} />
    </div>
  )
}

export default connect(R.pick(['games']))(Screenshots)
