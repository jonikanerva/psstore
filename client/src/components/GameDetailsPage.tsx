import { DateTime } from 'luxon'
import { useEffect, useState } from 'react'
import { fetchGame, searchLink, type Game } from '../modules/psnStore'
import Error from './Error'
import Image from './Image'
import Loading from './Spinner'
import './GameDetailsPage.css'

interface GameDetailsPageProps {
  gameId: string
}

const storeUrl = (id: string): string => `https://store.playstation.com/fi-fi/product/${id}`

const formatDate = (value: string): string => {
  const parsed = DateTime.fromISO(value)
  if (!parsed.isValid) {
    return 'Unknown'
  }

  return parsed.toLocaleString(DateTime.DATE_MED)
}

const GameDetailsPage = ({ gameId }: GameDetailsPageProps) => {
  const [game, setGame] = useState<Game | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false

    fetchGame(gameId)
      .then((resolved) => {
        if (!cancelled) {
          setGame(resolved)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [gameId])

  if (loading) {
    return <Loading loading={loading} />
  }

  if (error || !game) {
    return <Error message="Game not found" />
  }

  const hasDescription = game.description.trim().length > 0
  const hasScreenshots = game.screenshots.length > 0
  const hasVideos = game.videos.length > 0

  return (
    <article className="details-page">
      <section className="details-page--summary">
        <div className="details-page--cover">
          <Image url={game.url} name={game.name} />
        </div>
        <div className="details-page--info">
          <h1 className="details-page--title">{game.name}</h1>
          <div className="details-page--meta">{game.genres.join(', ') || 'Unknown genre'}</div>
          <div className="details-page--meta">Price: {game.price || '-'}</div>
          <div className="details-page--meta">Release: {formatDate(game.date)}</div>
          <div className="details-page--meta">Studio: {game.studio || '-'}</div>
          <div className="details-page--actions">
            <a className="details-page--link" href={storeUrl(game.id)}>
              Open In Store
            </a>
            <a className="details-page--link" href={searchLink(game.name)}>
              Metacritic
            </a>
          </div>
        </div>
      </section>

      {hasDescription && (
        <section className="details-page--section">
          <h2>Description</h2>
          <div dangerouslySetInnerHTML={{ __html: game.description }} />
        </section>
      )}

      {hasScreenshots && (
        <section className="details-page--section">
          <h2>Screenshots</h2>
          <div className="details-page--media-grid">
            {game.screenshots.map((screenshot) => (
              <div key={screenshot} className="details-page--media-item">
                <Image url={screenshot} name={game.name} />
              </div>
            ))}
          </div>
        </section>
      )}

      {hasVideos && (
        <section className="details-page--section">
          <h2>Videos</h2>
          <div className="details-page--media-grid">
            {game.videos.map((video) => (
              <video
                key={video}
                className="details-page--video"
                controls
                muted
                preload="metadata"
                src={video}
              />
            ))}
          </div>
        </section>
      )}
    </article>
  )
}

export default GameDetailsPage
