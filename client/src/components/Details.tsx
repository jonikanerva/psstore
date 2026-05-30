import { useParams } from '@tanstack/react-router'
import GameDetailsPage from './GameDetailsPage'

const Details = () => {
  const { gameId } = useParams({ from: '/g/$gameId' })
  return <GameDetailsPage gameId={gameId} />
}

export default Details
