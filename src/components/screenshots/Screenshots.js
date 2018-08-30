import React from 'react'
import ScrollToTopOnMount from '../scroll/ScrollToTopOnMount'
import { Link } from 'react-router-dom'

import './Screenshots.css'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`

const Name = ({ name }) => <div className="screenshots-name">{name}</div>

const ByLine = ({ genres, studio }) => (
  <div className="screenshots-byline">
    {genres} by {studio}
  </div>
)

const Buy = ({ id }) => (
  <a className="screenshots-buy" href={storeUrl(id)}>
    BUY
  </a>
)

const Images = ({ screenshots, name }) =>
  screenshots.map((screenshot, i) => (
    <Link to="/" key={i}>
      <img src={screenshot} alt={name} />
    </Link>
  ))

const Videos = ({ videos }) =>
  videos.map((video, i) => (
    <video preload="metadata" controls muted width="100%" src={video} key={i} />
  ))

const Description = ({ description }) => (
  <div
    className="screenshots-description"
    dangerouslySetInnerHTML={{ __html: description }}
  />
)

const Screenshots = ({ game }) => {
  const { id, description, genres, name, screenshots, studio, videos } = game

  return (
    <div className="screenshots-modal">
      <ScrollToTopOnMount />
      <div className="screenshots-top">
        <div className="screenshots-top-left">
          <Name name={name} />
          <ByLine genres={genres} studio={studio} />
        </div>
        <div className="screenshots-top-right">
          <Buy id={id} />
        </div>
      </div>
      <Images screenshots={screenshots} name={name} />
      <Videos videos={videos} />
      <Description description={description} />
    </div>
  )
}

export default Screenshots
