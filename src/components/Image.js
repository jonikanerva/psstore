import React from 'react'
import VisibilityObserver, {
  useVisibilityObserver
} from 'react-visibility-observer'
import './Image.css'

const ImageSrc = ({ url, name }) => {
  const { isVisible } = useVisibilityObserver()

  return (
    <img src={isVisible ? url : ''} alt={name} title={name} className="image" />
  )
}
const Image = ({ url, name }) => {
  return (
    <VisibilityObserver>
      <ImageSrc url={url} name={name} />
    </VisibilityObserver>
  )
}
export default Image
