import { useParams } from 'react-router-dom'
import GameDetailsPage from './GameDetailsPage'

const Details = () => {
  const params = useParams<{ gameId: string }>()
  const gameId = params.gameId || ''
  return <GameDetailsPage gameId={gameId} />
}

export default Details
