import { DateTime } from 'luxon'
import { Link } from 'react-router-dom'
import type { Game } from '@psstore/shared'
import Image from './Image'
import './GameCard.css'

interface GameCardProps {
  game: Game
}

const formatDate = (value: string): string => {
  const parsed = DateTime.fromISO(value)
  if (!parsed.isValid) {
    return 'Unknown'
  }

  return parsed.toLocaleString(DateTime.DATE_MED)
}

const GameCard = ({ game }: GameCardProps) => (
  <Link className="game-card" to={`/g/${game.id}`}>
    <div className="game-card--image-wrap">
      <Image url={game.url} name={game.name} />
    </div>
    <div className="game-card--body">
      <div className="game-card--name" title={game.name}>
        {game.name}
      </div>
      {game.genres.length > 0 && (
        <div className="game-card--genres" title={game.genres.join(', ')}>
          {game.genres.join(', ')}
        </div>
      )}
      <div className="game-card--meta">
        <span className="game-card--price">{game.price || '-'}</span>
        <span className="game-card--date">Released {formatDate(game.date)}</span>
      </div>
    </div>
  </Link>
)

export default GameCard
