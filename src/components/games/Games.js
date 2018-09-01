import React, { Component } from 'react'
import { connect } from 'react-redux'
import * as R from 'ramda'
import Game from '../game/Game'
import Loading from '../spinner/Spinner'
import Error from '../error/Error'
import { saveGamesToState, getGamesFromState } from '../../reducers/games'

import './Games.css'

const Header = ({ label, linkto, loading }) => (
  <a name={label} href={`#${linkto}`}>
    <div className="games--header">
      <div>{label}</div>
      <div className="games--header-loading">
        <Loading loading={loading} />
      </div>
    </div>
  </a>
)

const GameRows = ({ games, label, loading }) => {
  if (!games || R.isEmpty(games)) {
    return loading ? null : <Error message="No games found" />
  }

  return games.map(game => <Game game={game} label={label} key={game.id} />)
}

class Games extends Component {
  constructor(props) {
    super(props)

    this.state = { error: false, loading: true }
  }

  componentDidMount() {
    const { fetch, saveToState } = this.props

    fetch()
      .then(games => {
        saveToState(games)
        this.setState({ loading: false })
      })
      .catch(() => this.setState({ error: true }))
  }

  render() {
    const { label, linkto, games } = this.props
    const { loading, error } = this.state

    if (error) {
      return <Error />
    }

    return (
      <div className="games--list">
        <Header label={label} linkto={linkto} loading={loading} />

        <div className="games--table">
          <GameRows games={games} label={label} loading={loading} />
        </div>
      </div>
    )
  }
}

const mapStateToProps = (state, ownProps) => ({
  games: getGamesFromState(ownProps.label, state)
})

const mapDispatchToProps = (dispatch, ownProps) => ({
  saveToState: value => saveGamesToState(ownProps.label, value, dispatch)
})

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Games)
