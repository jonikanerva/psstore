import React from 'react'
import { BrowserRouter as Router, Route } from 'react-router-dom'
import GamesList from '../gameslist/GamesList'
import Screenshots from '../screenshots/Screenshots'
import SearchResults from '../searchresults/SearchResults'
import './App.css'

const App = () => (
  <Router>
    <React.Fragment>
      <Route exact={true} path="/" component={GamesList} />
      <Route path="/g/:gameId" component={Screenshots} />
      <Route path="/search" component={SearchResults} />
    </React.Fragment>
  </Router>
)

export default App
