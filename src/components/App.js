import React from 'react'
import { BrowserRouter as Router, Route } from 'react-router-dom'
import GamesList from './GamesList'
import Screenshots from './Screenshots'
import SearchResults from './SearchResults'
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
