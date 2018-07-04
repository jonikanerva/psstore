import React from 'react'
import TrackVisibility from 'react-on-screen'
import './Image.css'

const ImageSrc = props => (
  <img src={props.isVisible ? props.url : ''} alt={props.name} />
)

export const Image = props => (
  <TrackVisibility once={true} offset={200} className="image">
    <ImageSrc url={props.url} name={props.name} />
  </TrackVisibility>
)

export default Image
