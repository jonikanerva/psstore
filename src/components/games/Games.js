import React from 'react'
import Game from '../game/Game'
import Error from '../error/Error'
import Loading from '../spinner/Spinner'
import fetchGames from '../../modules/psnStore'
import localStorage from '../../modules/localStorage'
import './Games.css'

const GameRows = props =>
  props.games.map((game, id) => <Game game={game} sort={props.sort} key={id} />)

class Games extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      error: false,
      loading: true,
      games: localStorage.getItem('games')
    }
  }

  componentDidMount() {
    const { url, sort } = this.props

    fetchGames(url, sort)
      .then(games => {
        this.setState({ games, loading: false })
        localStorage.setItem('games', games)
      })
      .catch(() => this.setState({ error: true }))
  }

  render() {
    const { games, loading, error } = this.state
    const { sort } = this.props
    const showGames = !!games && !error

    return (
      <div className="games-table">
        <Error error={error} />
        <Loading loading={loading} />
        {showGames && <GameRows games={games} sort={sort} />}
      </div>
    )
  }
}

export default Games
