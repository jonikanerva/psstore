import './Image.css'

interface ImageProps {
  url: string
  name: string
}

const Image = ({ url, name }: ImageProps) => (
  <img src={url} alt={name} title={name} className="image" loading="lazy" />
)

export default Image
