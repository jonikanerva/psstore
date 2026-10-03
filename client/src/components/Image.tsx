interface ImageProps {
  url: string
  name: string
  // Above-the-fold image: fetched at once instead of lazily.
  priority?: boolean
}

const Image = ({ url, name, priority = false }: ImageProps) => (
  <img
    src={url}
    alt={name}
    title={name}
    className="image"
    loading={priority ? 'eager' : 'lazy'}
    fetchPriority={priority ? 'high' : 'auto'}
  />
)

export default Image
