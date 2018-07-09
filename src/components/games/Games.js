import React from 'react'
import Game from './Game'
import Error from '../error/Error'
import Loading from '../spinner/Spinner'
import fetchGames from '../../modules/psnStore'
import './Games.css'

const Rows = props =>
  props.games.map((game, id) => (
    <div key={id} className="separator">
      <Game game={game} sort={props.sort} />
    </div>
  ))

class Games extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      error: false,
      loading: true
    }
  }

  componentDidMount() {
    const { url, sort } = this.props

    fetchGames(url, sort)
      .then(games => this.setState({ games, loading: false }))
      .catch(() => this.setState({ error: true }))
  }

  render() {
    const { games, loading, error } = this.state
    const { sort } = this.props
    const showGames = !loading && !error

    return (
      <div className="gametable">
        <Error error={error} />
        <Loading loading={loading} />
        {showGames && <Rows games={games} sort={sort} />}
      </div>
    )
  }
}

export default Games
