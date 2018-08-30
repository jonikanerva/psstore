import React, { Component } from 'react'
import { BrowserRouter as Router, Route } from 'react-router-dom'
import * as R from 'ramda'
import fetchGames from '../../modules/psnStore'
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

    this.renderScreenshots = this.renderScreenshots.bind(this)
    this.renderGameList = this.renderGameList.bind(this)
  }

  componentDidMount() {
    fetchGames()
      .then(({ newGames, discountedGames, upcomingGames }) => {
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

  renderGameList() {
    const { newGames, upcomingGames, discountedGames, loading } = this.state

    return (
      <GamesList
        loading={loading}
        newGames={newGames}
        upcomingGames={upcomingGames}
        discountedGames={discountedGames}
      />
    )
  }

  render() {
    if (this.state.error) {
      return <Error />
    }

    return (
      <Router>
        <React.Fragment>
          <Route exact={true} path="/" render={this.renderGameList} />
          <Route path="/g/:gameId" render={this.renderScreenshots} />
        </React.Fragment>
      </Router>
    )
  }
}

export default App
