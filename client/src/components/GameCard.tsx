import { DateTime } from 'luxon'
import { Link } from 'react-router-dom'
import type { Game } from '@psstore/shared'
import Image from './Image'
import './GameCard.css'

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

const GameCard = ({ game }: GameCardProps) => {
  const hasDiscount = Boolean(game.originalPrice) && game.originalPrice !== game.price

  return (
    <Link className="game-card" to={`/g/${game.id}`}>
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
            {hasDiscount && (
              <s className="game-card--original-price">{game.originalPrice}</s>
            )}
            {game.price || '-'}
          </span>
        </div>
      </div>
    </Link>
  )
}

export default GameCard
