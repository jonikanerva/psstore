import { Link } from '@tanstack/react-router'
import { DateTime } from 'luxon'
import type { Game } from '@psstore/shared'
import Image from './Image'

interface GameCardProps {
  game: Game
}

const formatDate = (value: string): string => {
  if (!value) {
    return ''
  }

  const parsed = DateTime.fromISO(value)
  return parsed.isValid ? parsed.toLocaleString(DateTime.DATE_MED) : ''
}

// Concept-only UPCOMING cards (idKind === 'concept') have no internal PDP and
// no anonymously-available price. They link OUT to Sony's concept page (the
// `en-fi` locale segment is confirmed to resolve anonymously) and show
// "Unknown" in the price slot. Everything else (default `product`) keeps the
// internal PDP Link and normal price rendering, unchanged.
const conceptHref = (id: string): string =>
  `https://store.playstation.com/en-fi/concept/${id}`

const GameCard = ({ game }: GameCardProps) => {
  const hasDiscount =
    Boolean(game.originalPrice) && game.originalPrice !== game.price
  const isConcept = game.idKind === 'concept'

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
        </div>
      </div>
    </>
  )

  if (isConcept) {
    return (
      <a
        className="game-card"
        href={conceptHref(game.id)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${game.name} on PlayStation Store`}
      >
        {body}
      </a>
    )
  }

  return (
    <Link className="game-card" to="/g/$gameId" params={{ gameId: game.id }}>
      {body}
    </Link>
  )
}

export default GameCard
