import { Link, useRouterState } from '@tanstack/react-router'
import { DateTime } from 'luxon'
import type { Game } from '@psstore/shared'
import { pdpOriginForPath } from '../modules/pdpOrigin'
import Image from './Image'

interface GameCardProps {
  game: Game
  showPrice?: boolean
  // Open the internal game page even for a concept id.
  internalLink?: boolean
}

const formatDate = (value: string): string => {
  if (!value) {
    return ''
  }

  const parsed = DateTime.fromISO(value)
  return parsed.isValid
    ? parsed.toLocaleString(DateTime.DATE_MED, {
        locale: 'en-GB',
      })
    : ''
}

// Concept-only cards have no product id, so they link to Sony's concept page.
const storeHref = (conceptId: string): string =>
  `https://store.playstation.com/en-fi/concept/${conceptId}`

const GameCard = ({
  game,
  showPrice = true,
  internalLink = false,
}: GameCardProps) => {
  const hasDiscount =
    Boolean(game.originalPrice) && game.originalPrice !== game.price
  // Concept-only UPCOMING cards have no anonymously-available price: the price
  // slot shows "Unknown". The internal game page needs a product id.
  const isConcept = game.idKind === 'concept'
  const pdpOrigin = useRouterState({
    select: (state) => pdpOriginForPath(state.location.pathname),
  })
  // Router history state is not augmented: the origin is read back through
  // readPdpOrigin, and a variable avoids the empty-interface literal check.
  const historyState = { pdpOrigin }

  const body = (
    <>
      <div className="game-card--image-wrap">
        <Image url={game.url} name={game.name} />
      </div>
      <div className="game-card--body">
        <div className="game-card--name" title={game.name}>
          {game.name}
        </div>
        <div className="game-card--meta">
          <span className="game-card--date">{formatDate(game.date)}</span>
          {showPrice && (
            <span className="game-card--price">
              {isConcept ? (
                'Unknown'
              ) : (
                <>
                  {hasDiscount && (
                    <s className="game-card--original-price">
                      {game.originalPrice}
                    </s>
                  )}
                  {game.price || '-'}
                  {game.plusUpsellText !== null && (
                    <span className="game-card--plus">
                      PS+ {game.plusUpsellText}
                    </span>
                  )}
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </>
  )

  if (isConcept && !internalLink) {
    return (
      <a
        className="game-card"
        href={storeHref(game.id)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${game.name} on PlayStation Store`}
      >
        {body}
      </a>
    )
  }

  return (
    <Link
      className="game-card"
      to="/g/$gameId"
      params={{ gameId: game.id }}
      state={historyState}
    >
      {body}
    </Link>
  )
}

export default GameCard
