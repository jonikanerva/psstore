import { Link, useRouterState } from '@tanstack/react-router'
import { DateTime } from 'luxon'
import type { Game } from '@psstore/shared'
import { useFocusReturn, viewKeyFor } from '../modules/focusReturn'
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

// The price sort reads an included PS Plus offer as 0 €, so a card with that
// offer shows "Included". The offer is the exact signal and wins over Sony's
// label: a Premium Classic has the label "Premium", which Sony also uses for
// a trial. The game page uses the same order. A card without an included
// offer shows Sony's label, for example "Extra". A game from the persisted
// cache can lack the `plusOffer` key.
const plusLabel = (game: Game): string | null =>
  game.plusOffer?.kind === 'included' ? 'Included' : game.plusUpsellText

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
  const plus = plusLabel(game)
  const pdpOrigin = useRouterState({
    select: (state) => pdpOriginForPath(state.location.pathname),
  })

  const focusReturn = useFocusReturn()
  const viewKey = useRouterState({
    select: (state) =>
      viewKeyFor(state.location.pathname, state.location.search),
  })

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
                  {plus !== null && (
                    <span className="game-card--plus">PS+ {plus}</span>
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
      data-game-id={game.id}
      onClick={(event) => {
        const plain =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        if (focusReturn !== null && plain) {
          focusReturn.current = { gameId: game.id, fromKey: viewKey }
        }
      }}
      to="/g/$gameId"
      params={{ gameId: game.id }}
      state={(previous) => ({ ...previous, pdpOrigin })}
    >
      {body}
    </Link>
  )
}

export default GameCard
