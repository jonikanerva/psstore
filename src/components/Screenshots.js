import React from 'react'
import { connect } from 'react-redux'
import { DateTime } from 'luxon'
import * as R from 'ramda'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Error from './Error'
import Image from './Image'

import './Screenshots.css'
import { searchLink } from '../modules/psnStore'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = date =>
  DateTime.fromISO(date).toLocaleString({
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  })

const Images = ({ screenshots, name }) =>
  screenshots.map((screenshot, i) => (
    <div key={i} className="screenshots--tile">
      <Image url={screenshot} name={name} />
    </div>
  ))

const Videos = ({ videos }) =>
  videos.map((video, i) => (
    <div key={i} className="screenshots--tile">
      <video preload="metadata" controls muted width="100%" src={video} />
    </div>
  ))

const findGame = (gameId, games) =>
  R.compose(
    R.find(R.propEq('id', gameId)),
    R.reject(R.isNil),
    R.flatten,
    R.props([
      'newGames',
      'discountedGames',
      'upcomingGames',
      'searchGames',
      'plusGames'
    ])
  )(games)

const Screenshots = props => {
  const gameId = props.match.params.gameId
  const games = props.games
  const game = findGame(gameId, games)

  if (!game) {
    return <Error />
  }

  const {
    date,
    description,
    discountDate,
    genres,
    id,
    name,
    price,
    screenshots,
    studio,
    videos
  } = game
  const discounted = discountDate !== '1975-01-01T00:00:00Z'
  const search = searchLink(name)

  return (
    <div className="screenshots">
      <ScrollToTopOnMount />

      <div className="screenshots--top">
        <div className="screenshots--header">{name}</div>
        <a className="screenshots--buy" href={storeUrl(id)}>
          BUY
        </a>
      </div>
      <div className="screenshots--subheader">
        {genres} by {studio}
      </div>
      <div className="screenshots--subheader">Released {dateFormat(date)}</div>
      {discounted && (
        <div className="screenshots--subheader">
          Discounted {dateFormat(discountDate)}
        </div>
      )}
      <div className="screenshots--price">{price}</div>

      <div className="screenshots--images">
        <Images screenshots={screenshots} name={name} />
        <Videos videos={videos} />
      </div>

      <div className="screenshots--subheader">
        <a href={search}>Metacritic Review</a>
      </div>

      <div
        className="screenshots--description"
        dangerouslySetInnerHTML={{ __html: description }}
      />
    </div>
  )
}

export default connect(R.pick(['games']))(Screenshots)
