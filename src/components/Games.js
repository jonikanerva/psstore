import * as R from 'ramda'
import React, { Component } from 'react'
import { connect } from 'react-redux'
import Error from './Error'
import Game from './Game'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Loading from './Spinner'
import Navigation from './Navigation'
import { setGamesToState, getGamesFromState } from '../reducers/games'

import './Games.css'

const isEmpty = R.either(R.isEmpty, R.isNil)

class Games extends Component {
  constructor(props) {
    super(props)

    this.state = { error: false, loading: true }
  }

  componentDidMount() {
    const { fetch, saveToState } = this.props

    fetch()
      .then(saveToState)
      .then(() => this.setState({ loading: false }))
      .catch(() => this.setState({ error: true }))
  }

  render() {
    const { games, label } = this.props
    const { loading, error } = this.state
    const hasGames = !isEmpty(games)

    if (error) {
      return <Error />
    }

    if (!loading && !hasGames) {
      return <Error message="No games found" />
    }

    return (
      <React.Fragment>
        <ScrollToTopOnMount />
        <Navigation />
        {loading ? (
          <Loading loading={loading} />
        ) : (
          <div className="games--content">
            {games.map(game => (
              <Game label={label} game={game} key={game.id} />
            ))}
          </div>
        )}
      </React.Fragment>
    )
  }
}

const mapStateToProps = (state, ownProps) => ({
  games: getGamesFromState(ownProps.label, state)
})

const mapDispatchToProps = (dispatch, ownProps) => ({
  saveToState: value => setGamesToState(ownProps.label, value, dispatch)
})

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Games)
