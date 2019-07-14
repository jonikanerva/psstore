import React from 'react'
import {
  BrowserRouter as Router,
  Route,
  Redirect,
  Switch
} from 'react-router-dom'
import Games from './Games'
import Details from './Details'
import SearchResults from './SearchResults'
import {
  fetchNewGames,
  fetchDiscountedGames,
  fetchUpcomingGames,
  fetchPlusGames
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
const PlusGames = () => <Games label="plus" fetch={fetchPlusGames} />

const App = () => (
  <Router>
    <Switch>
      <Route path="/new" component={NewGames} />
      <Route path="/discounted" component={DiscountedGames} />
      <Route path="/upcoming" component={UpcomintGames} />
      <Route path="/plus" component={PlusGames} />
      <Route path="/g/:gameId" component={Details} />
      <Route path="/search" component={SearchResults} />
      <Route component={RedirectNew} />
    </Switch>
  </Router>
)

export default App
