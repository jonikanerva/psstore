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
      name: props.name,
      screenshots: props.screenshots,
      showScreenshots: false,
      url: props.url
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
    const { url, name, showScreenshots, screenshots } = this.state

    return (
      <div onClick={this.toggleScreenshots}>
        <TrackVisibility once={true} offset={200} className="image">
          <ImageSrc url={url} name={name} />
        </TrackVisibility>
        <Screenshots
          show={showScreenshots}
          screenshots={screenshots}
          onClose={this.toggleScreenshots}
        />
      </div>
    )
  }
}

export default Image
