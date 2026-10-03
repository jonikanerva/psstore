import { useRef, useState } from 'react'
import Image from './Image'

interface MediaGalleryProps {
  name: string
  screenshots: readonly string[]
  videos: readonly string[]
}

interface MediaItem {
  kind: 'image' | 'video'
  src: string
}

const MediaGallery = ({ name, screenshots, videos }: MediaGalleryProps) => {
  const items: MediaItem[] = [
    ...screenshots.map((src): MediaItem => ({ kind: 'image', src })),
    ...videos.map((src): MediaItem => ({ kind: 'video', src })),
  ]
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const current = openIndex === null ? undefined : items[openIndex]

  // The carousel wraps at both ends.
  const step = (delta: number) => {
    setOpenIndex((index) =>
      index === null ? null : (index + delta + items.length) % items.length,
    )
  }

  const close = () => {
    setOpenIndex(null)
    triggerRef.current?.focus()
  }

  return (
    <>
      <div className="media-gallery">
        {items.map((item, index) => (
          <button
            key={item.src}
            type="button"
            className="media-gallery--item"
            aria-label={`Open ${item.kind} ${String(index + 1)} of ${String(items.length)}`}
            onClick={(event) => {
              triggerRef.current = event.currentTarget
              setOpenIndex(index)
            }}
          >
            {item.kind === 'image' ? (
              <Image url={item.src} name={name} />
            ) : (
              <>
                <video
                  className="media-gallery--thumb-video"
                  muted
                  preload="metadata"
                  src={item.src}
                />
                <span className="media-gallery--play" aria-hidden="true">
                  ▶
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      {current && (
        <dialog
          className="lightbox"
          aria-label={`${name} media`}
          ref={(element) => {
            if (element && !element.open) {
              element.showModal()
            }
          }}
          onClose={close}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              close()
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              step(1)
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault()
              step(-1)
            }
          }}
        >
          <button
            type="button"
            className="lightbox--close"
            aria-label="Close"
            onClick={close}
          >
            ✕
          </button>
          {items.length > 1 && (
            <>
              <button
                type="button"
                className="lightbox--nav lightbox--prev"
                aria-label="Previous"
                onClick={() => {
                  step(-1)
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="lightbox--nav lightbox--next"
                aria-label="Next"
                onClick={() => {
                  step(1)
                }}
              >
                ›
              </button>
            </>
          )}
          {current.kind === 'image' ? (
            <img
              key={current.src}
              className="lightbox--media"
              src={current.src}
              alt={name}
            />
          ) : (
            // Autofocus lets the space bar start playback. Playback never
            // starts without a user action.
            <video
              key={current.src}
              className="lightbox--media"
              controls
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- keyboard playback needs focus on the video
              autoFocus
              preload="metadata"
              src={current.src}
            />
          )}
        </dialog>
      )}
    </>
  )
}

export default MediaGallery
