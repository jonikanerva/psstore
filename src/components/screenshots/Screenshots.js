import React from 'react'
import './Screenshots.css'

const Images = props =>
  props.screenshots.map((screenshot, i) => (
    <img src={screenshot} alt={props.name} key={i} />
  ))

const Videos = props =>
  props.videos.map((video, i) => (
    <video preload="metadata" controls muted width="100%" src={video} key={i} />
  ))

const Screenshots = props => {
  const { description, genres, name, screenshots, studio, videos } = props.game
  const { show, onClose } = props

  return !show ? null : (
    <div className="screenshots-modal" onClick={onClose}>
      <div className="screenshots-name">{name}</div>
      <div className="screenshots-byline">
        {genres} by {studio}
      </div>

      <Images screenshots={screenshots} name={name} />
      <Videos videos={videos} />

      <div
        className="screenshots-description"
        dangerouslySetInnerHTML={{ __html: description }}
      />
    </div>
  )
}

export default Screenshots
