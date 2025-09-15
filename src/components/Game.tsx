import { Link } from 'react-router-dom'
import Image from './Image'
import './Game.css'

interface GameProps {
  id: string
  name: string
  url: string
}

const Game = ({ id, name, url }: GameProps) => (
  <div className="game--tile">
    <Link to={`/g/${id}`}>
      <Image url={url} name={name} />
    </Link>
  </div>
)

export default Game
