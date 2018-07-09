import React, { Component } from 'react'
import TrackVisibility from 'react-on-screen'
import Screenshots from '../screenshots/Screenshots'
import './Image.css'

const ImageSrc = props => (
  <img src={props.isVisible ? props.url : ''} alt={props.name} />
)

class Image extends Component {
  constructor(props) {
    super(props)

    this.state = {
      showScreenshots: false
    }
  }

  toggleScreenshots = e => {
    this.setState({
      showScreenshots: !this.state.showScreenshots
    })

    // prevent scrolling on body when the screenshots are visible
    document.body.style.overflow = this.state.showScreenshots
      ? 'visible'
      : 'hidden'

    // don't follow the link on click
    e.preventDefault()
  }

  render() {
    const { showScreenshots } = this.state
    const {
      description,
      genres,
      name,
      screenshots,
      studio,
      url,
      videos
    } = this.props

    return (
      <div onClick={this.toggleScreenshots}>
        <TrackVisibility once={true} offset={200} className="image">
          <ImageSrc url={url} name={name} />
        </TrackVisibility>
        <Screenshots
          description={description}
          genres={genres}
          name={name}
          screenshots={screenshots}
          show={showScreenshots}
          studio={studio}
          videos={videos}
          onClose={this.toggleScreenshots}
        />
      </div>
    )
  }
}

export default Image
