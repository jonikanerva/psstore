import { useQuery } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import { DateTime } from 'luxon'
import { fetchGame, metacriticLink, type Game } from '../modules/psnStore'
import Error from './Error'
import Image from './Image'
import Offline from './Offline'
import Loading from './Spinner'

interface GameDetailsPageProps {
  gameId: string
}

const storeUrl = (id: string): string =>
  `https://store.playstation.com/en-fi/product/${id}`

const formatDate = (value: string): string => {
  const parsed = DateTime.fromISO(value)
  if (!parsed.isValid) {
    return 'Unknown'
  }

  return parsed.toLocaleString(DateTime.DATE_MED, {
    locale: 'en-GB',
  })
}

// A game read from the persisted client cache can lack the `plusOffer` key.
// Test it for truthiness; do not compare it with null.
const plusValueFor = (game: Game): string | null => {
  if (game.plusOffer) {
    return game.plusOffer.kind === 'price' ? game.plusOffer.price : 'Included'
  }

  return game.plusUpsellText
}

const GameDetailsPage = ({ gameId }: GameDetailsPageProps) => {
  const {
    data: game,
    isPending,
    isError,
    fetchStatus,
  } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => fetchGame(gameId),
    enabled: gameId !== '',
  })

  if (isPending) {
    return fetchStatus === 'paused' ? <Offline /> : <Loading loading />
  }

  if (isError) {
    return <Error message="Game not found" />
  }

  const plusValue = plusValueFor(game)
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
          <dl className="details-page--meta-list">
            {game.price && (
              <>
                <dt>Standard</dt>
                <dd>{game.price}</dd>
              </>
            )}
            {plusValue !== null && (
              <>
                <dt>PS Plus</dt>
                <dd>{plusValue}</dd>
              </>
            )}
            <dt>Release</dt>
            <dd>{formatDate(game.date)}</dd>
            {game.studio && (
              <>
                <dt>Publisher</dt>
                <dd>{game.studio}</dd>
              </>
            )}
            {game.genres.length > 0 && (
              <>
                <dt>Genre</dt>
                <dd>{game.genres.join(', ')}</dd>
              </>
            )}
          </dl>
          <div className="details-page--actions">
            <a className="details-page--link" href={storeUrl(game.id)}>
              Open In Store
            </a>
            <a className="details-page--link" href={metacriticLink(game.name)}>
              Metacritic
            </a>
          </div>
        </div>
      </section>

      {(hasScreenshots || hasVideos) && (
        <section className="details-page--section">
          <h2>Media</h2>
          <div className="details-page--media-grid">
            {game.screenshots.map((screenshot) => (
              <div key={screenshot} className="details-page--media-item">
                <Image url={screenshot} name={game.name} />
              </div>
            ))}
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

      {hasDescription && (
        <section className="details-page--section">
          <h2>Description</h2>
          {/* XSS boundary: Sony's description HTML is untrusted and is sanitised
              with DOMPurify before injection. Do not remove or reorder (da #5). */}
          <div
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(game.description),
            }}
          />
        </section>
      )}
    </article>
  )
}

export default GameDetailsPage
