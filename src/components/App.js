import React from 'react'
import {
  BrowserRouter as Router,
  Route,
  Redirect,
  Switch
} from 'react-router-dom'
import Games from './Games'
import Screenshots from './Screenshots'
import SearchResults from './SearchResults'
import {
  fetchNewGames,
  fetchDiscountedGames,
  fetchUpcomingGames
} from '../modules/psnStore'

import './App.css'

const RedirectNew = () => <Redirect to="/new" />
const NewGames = () => <Games label="new" fetch={fetchNewGames} />
const DiscountedGames = () => (
  <Games label="discounted" fetch={fetchDiscountedGames} />
)
const UpcomintGames = () => (
  <Games label="upcoming" fetch={fetchUpcomingGames} />
)

const App = () => (
  <Router>
    <Switch>
      <Route path="/new" component={NewGames} />
      <Route path="/discounted" component={DiscountedGames} />
      <Route path="/upcoming" component={UpcomintGames} />
      <Route path="/g/:gameId" component={Screenshots} />
      <Route path="/search" component={SearchResults} />
      <Route component={RedirectNew} />
    </Switch>
  </Router>
)

export default App
