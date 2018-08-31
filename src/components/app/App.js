import React, { Component } from 'react'
import { BrowserRouter as Router, Route } from 'react-router-dom'
import * as R from 'ramda'
import GamesList from '../gameslist/GamesList'
import Screenshots from '../screenshots/Screenshots'
import Error from '../error/Error'
import './App.css'

class App extends Component {
  constructor(props) {
    super(props)

    this.renderScreenshots = this.renderScreenshots.bind(this)
  }

  renderScreenshots({ match }) {
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
    return (
      <Router>
        <React.Fragment>
          <Route exact={true} path="/" component={GamesList} />
          <Route path="/g/:gameId" render={this.renderScreenshots} />
        </React.Fragment>
      </Router>
    )
  }
}

export default App
