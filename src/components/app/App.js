import React, { Component } from 'react'
import { BrowserRouter as Router, Route } from 'react-router-dom'
import * as R from 'ramda'
import {
  fetchNewGames,
  fetchUpcomingGames,
  fetchDiscountedGames
} from '../../modules/psnStore'
import localStorage from '../../modules/localStorage'
import GamesList from '../gameslist/GamesList'
import Screenshots from '../screenshots/Screenshots'
import Error from '../error/Error'
import './App.css'

class App extends Component {
  constructor(props) {
    super(props)

    this.state = {
      error: false,
      loading: true,
      newGames: localStorage.getItem('newGames'),
      discountedGames: localStorage.getItem('discountedGames'),
      upcomingGames: localStorage.getItem('upcomingGames')
    }
  }

  componentDidMount() {
    Promise.all([fetchNewGames(), fetchDiscountedGames(), fetchUpcomingGames()])
      .then(([newGames, discountedGames, upcomingGames]) => {
        this.setState({
          loading: false,
          newGames,
          discountedGames,
          upcomingGames
        })
        localStorage.setItem('newGames', newGames)
        localStorage.setItem('discountedGames', discountedGames)
        localStorage.setItem('upcomingGames', upcomingGames)
      })
      .catch(() => this.setState({ error: true }))
  }

  findGameAndRenderScreenshots = ({ match }) => {
    const gameId = match.params.gameId
    const { loading, newGames, discountedGames, upcomingGames } = this.state

    const game = R.compose(
      R.find(R.propEq('id', gameId)),
      R.reject(R.isNil),
      R.flatten
    )([newGames, discountedGames, upcomingGames])

    if (!game && loading) {
      return null
    }

    return game ? <Screenshots game={game} /> : <Error />
  }

  render() {
    const {
      newGames,
      upcomingGames,
      discountedGames,
      error,
      loading
    } = this.state

    return error ? (
      <Error />
    ) : (
      <Router>
        <React.Fragment>
          <Route
            exact={true}
            path="/"
            render={() => (
              <GamesList
                loading={loading}
                newGames={newGames}
                upcomingGames={upcomingGames}
                discountedGames={discountedGames}
              />
            )}
          />
          <Route path="/g/:gameId" render={this.findGameAndRenderScreenshots} />
        </React.Fragment>
      </Router>
    )
  }
}

export default App
