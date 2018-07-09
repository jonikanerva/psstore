import React, { Component } from 'react'
import './Screenshots.css'

class Screenshots extends Component {
  render() {
    const {
      description,
      genres,
      name,
      screenshots,
      studio,
      videos
    } = this.props

    return !this.props.show ? null : (
      <div className="screenshots-modal">
        <div className="screenshots-name">{name}</div>
        <div className="screenshots-byline">
          {genres} by {studio}
        </div>

        {screenshots.map((screenshot, i) => (
          <img src={screenshot} alt={name} key={i} />
        ))}

        {videos.map((video, i) => (
          <video
            preload="metadata"
            controls
            muted
            width="100%"
            src={video}
            key={i}
          />
        ))}

        <div
          className="screenshots-description"
          dangerouslySetInnerHTML={{ __html: description }}
        />
      </div>
    )
  }
}

export default Screenshots
