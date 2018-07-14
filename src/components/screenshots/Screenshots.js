import React from 'react'
import ScrollToTopOnMount from '../../modules/ScrollToTopOnMount'

import './Screenshots.css'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`

const Name = props => <div className="screenshots-name">{props.name}</div>

const ByLine = props => (
  <div className="screenshots-byline">
    {props.genres} by {props.studio}
  </div>
)

const Buy = props => (
  <a className="screenshots-buy" href={storeUrl(props.id)}>
    BUY
  </a>
)

const Images = props =>
  props.screenshots.map((screenshot, i) => (
    <img src={screenshot} alt={props.name} key={i} />
  ))

const Videos = props =>
  props.videos.map((video, i) => (
    <video preload="metadata" controls muted width="100%" src={video} key={i} />
  ))

const Description = props => (
  <div
    className="screenshots-description"
    dangerouslySetInnerHTML={{ __html: props.description }}
  />
)

const Screenshots = props => {
  const {
    id,
    description,
    genres,
    name,
    screenshots,
    studio,
    videos
  } = props.game

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
