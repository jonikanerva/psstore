import React from 'react'
import TrackVisibility from 'react-on-screen'
import './Image.css'

const ImageSrc = ({ isVisible, url, name }) => (
  <img src={isVisible ? url : ''} alt={name} title={name} className="image" />
)

const Image = ({ url, name }) => (
  <TrackVisibility once={true} offset={1000}>
    <ImageSrc url={url} name={name} />
  </TrackVisibility>
)

export default Image
