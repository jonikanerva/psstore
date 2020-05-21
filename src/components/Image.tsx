import React from 'react'
import VisibilityObserver, {
  useVisibilityObserver,
} from 'react-visibility-observer'
import './Image.css'

interface ImageProps {
  url: string
  name: string
}

const ImageSrc = ({ url, name }: ImageProps): JSX.Element => {
  const { isVisible } = useVisibilityObserver()

  return (
    <img src={isVisible ? url : ''} alt={name} title={name} className="image" />
  )
}

const Image = ({ url, name }: ImageProps): JSX.Element => (
  <VisibilityObserver rootMargin="200px 200px 200px 200px" triggerOnce={true}>
    <ImageSrc url={url} name={name} />
  </VisibilityObserver>
)

export default Image
