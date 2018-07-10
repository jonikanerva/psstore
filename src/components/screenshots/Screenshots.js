import React from 'react'
import './Screenshots.css'

const Name = props => <div className="screenshots-name">{props.name}</div>

const ByLine = props => (
  <div className="screenshots-byline">
    {props.genres} by {props.studio}
  </div>
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
  const { description, genres, name, screenshots, studio, videos } = props.game
  const { show, onClose } = props

  return !show ? null : (
    <div className="screenshots-modal" onClick={onClose}>
      <Name name={name} />
      <ByLine genres={genres} studio={studio} />
      <Images screenshots={screenshots} name={name} />
      <Videos videos={videos} />
      <Description description={description} />
    </div>
  )
}

export default Screenshots
