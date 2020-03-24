import React from 'react'
import {
  BrowserRouter as Router,
  Route,
  Redirect,
  Switch,
} from 'react-router-dom'
import Games from './Games'
import Details from './Details'
import SearchResults from './SearchResults'
import {
  fetchNewGames,
  fetchDiscountedGames,
  fetchUpcomingGames,
  fetchPlusGames,
} from '../modules/psnStore'

import './App.css'

const RedirectNew = () => <Redirect to="/new" />
const NewGames = ({ location }) => (
  <Games label="new" location={location} fetch={fetchNewGames} />
)
const DiscountedGames = ({ location }) => (
  <Games label="discounted" location={location} fetch={fetchDiscountedGames} />
)
const UpcomintGames = ({ location }) => (
  <Games label="upcoming" location={location} fetch={fetchUpcomingGames} />
)
const PlusGames = ({ location }) => (
  <Games label="plus" location={location} fetch={fetchPlusGames} />
)

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
