import * as R from 'ramda'
import React, { useEffect, useState } from 'react'
import { DateTime } from 'luxon'

import Image from './Image'
import Loading from './Spinner'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import { searchLink, fetchGame } from '../modules/psnStore'

import './Screenshots.css'

const storeUrl = (id) => `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = (date) =>
  DateTime.fromISO(date).toLocaleString({
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
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

const Screenshots = ({ gameId }) => {
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchGame(gameId)
      .then(R.head)
      .then(setGame)
      .then(() => setLoading(false))
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [gameId])

  if (loading) {
    return (
      <div className="screenshots">
        <Loading loading={loading} />
      </div>
    )
  }

  if (error || !game) {
    return <div className="screenshots">Game not found!</div>
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
    videos,
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

export default Screenshots
