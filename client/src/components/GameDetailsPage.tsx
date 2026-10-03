import { useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import { DateTime } from 'luxon'
import { findCachedGame } from '../modules/cachedGame'
import { fetchGame, metacriticLink, type Game } from '../modules/psnStore'
import Error from './Error'
import Image from './Image'
import MediaGallery from './MediaGallery'
import Offline from './Offline'

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

const DetailsSkeleton = () => (
  <article className="details-page" aria-busy="true">
    <div role="status" className="sr-only">
      Loading
    </div>
    <section className="details-page--hero">
      <div className="details-page--cover" />
      <div className="details-page--info">
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--block" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--line" />
      </div>
    </section>
  </article>
)

const GameDetailsPage = ({ gameId }: GameDetailsPageProps) => {
  const queryClient = useQueryClient()
  const {
    data: game,
    isPending,
    isError,
    isPlaceholderData,
    fetchStatus,
  } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => fetchGame(gameId),
    enabled: gameId !== '',
    // List views already hold the name, cover, and prices: paint them at once.
    placeholderData: () => findCachedGame(queryClient, gameId),
  })

  if (isPending) {
    return fetchStatus === 'paused' ? <Offline /> : <DetailsSkeleton />
  }

  if (isError) {
    return <Error message="Game not found" />
  }

  const plusValue = plusValueFor(game)
  const hasDescription = game.description.trim().length > 0
  const hasMedia = game.screenshots.length > 0 || game.videos.length > 0
  const hasDiscount =
    game.originalPrice !== '' && game.originalPrice !== game.price

  return (
    <article className="details-page" aria-busy={isPlaceholderData}>
      <section className="details-page--hero">
        <div className="details-page--cover">
          <Image url={game.url} name={game.name} priority />
        </div>
        <div className="details-page--info">
          <h1 className="details-page--title">{game.name}</h1>

          <dl className="details-page--meta-list">
            <div>
              <dt>Release</dt>
              <dd>{formatDate(game.date)}</dd>
            </div>
            {isPlaceholderData ? (
              <>
                <div>
                  <dt>Publisher</dt>
                  <dd>
                    <span className="skeleton skeleton--inline" />
                  </dd>
                </div>
                <div>
                  <dt>Genre</dt>
                  <dd>
                    <span className="skeleton skeleton--inline" />
                  </dd>
                </div>
              </>
            ) : (
              <>
                {game.studio && (
                  <div>
                    <dt>Publisher</dt>
                    <dd>{game.studio}</dd>
                  </div>
                )}
                {game.genres.length > 0 && (
                  <div>
                    <dt>Genre</dt>
                    <dd>{game.genres.join(', ')}</dd>
                  </div>
                )}
              </>
            )}
          </dl>

          <div className="details-page--buy">
            {game.price && (
              <div className="details-page--price">
                <span className="details-page--price-label">Standard</span>
                <span className="details-page--price-value">
                  {hasDiscount && <s>{game.originalPrice}</s>}
                  {game.price}
                </span>
              </div>
            )}
            {plusValue !== null && (
              <div className="details-page--price">
                <span className="details-page--price-label">PS Plus</span>
                <span className="details-page--price-value">{plusValue}</span>
              </div>
            )}

            <div className="details-page--actions">
              <a
                className="details-page--link details-page--link-primary"
                href={storeUrl(game.id)}
              >
                Open In Store
              </a>
              <a
                className="details-page--link"
                href={metacriticLink(game.name)}
              >
                Metacritic
              </a>
            </div>
          </div>
        </div>
      </section>

      {isPlaceholderData && (
        <section className="details-page--section" role="status">
          <span className="sr-only">Loading</span>
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
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

      {hasMedia && (
        <section className="details-page--section" aria-label="Media">
          <MediaGallery
            name={game.name}
            screenshots={game.screenshots}
            videos={game.videos}
          />
        </section>
      )}
    </article>
  )
}

export default GameDetailsPage
