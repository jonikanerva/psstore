import React, { Component } from 'react'
import NewGames from '../games/NewGames'
import UpcomingGames from '../games/UpcomingGames'
import './App.css'

class App extends Component {
  render() {
    return (
      <div className="parent">
        <div className="list">
          <div className="header">New</div>
          <NewGames />
        </div>

        <div className="list">
          <div className="header">Upcoming</div>
          <UpcomingGames />
        </div>
      </div>
    )
  }
}

export default App
