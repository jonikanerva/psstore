import { DateTime } from 'luxon'
import * as R from 'ramda'
import React, { useEffect, useState, Fragment } from 'react'
import { fetchGame, Game, searchLink } from '../modules/psnStore'
import Image from './Image'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import './Screenshots.css'

interface ScreenshotsProps {
  gameId: string
}

const storeUrl = (id: string): string =>
  `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = (date: string): string =>
  DateTime.fromISO(date).toLocaleString({
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }) || ''

const Images = ({
  screenshots,
  name,
}: {
  screenshots: string[]
  name: string
}): JSX.Element => (
  <Fragment>
    {screenshots.map((screenshot: string, i: number) => (
      <div key={i} className="screenshots--tile">
        <Image url={screenshot} name={name} />
      </div>
    ))}
  </Fragment>
)

const Videos = ({ videos }: { videos: string[] }): JSX.Element => (
  <Fragment>
    {videos.map((video: string, i: number) => (
      <div key={i} className="screenshots--tile">
        <video preload="metadata" controls muted width="100%" src={video} />
      </div>
    ))}
  </Fragment>
)

const Screenshots = ({ gameId }: ScreenshotsProps): JSX.Element => {
  const [game, setGame] = useState<Game>()
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<boolean>(false)

  useEffect(() => {
    fetchGame(gameId)
      .then((games) => R.head(games))
      .then((game) => setGame(game))
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
        {genres.join(', ')} by {studio}
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
