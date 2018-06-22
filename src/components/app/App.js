import React, { Component } from 'react'
import Games from '../games/Games'
import './App.css'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMELATEST?sort=release_date&direction=desc&platform=ps4&game_content_type=games&size=100&bucket=games&start=0'

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'

class App extends Component {
  render() {
    return (
      <div className="parent">
        <div className="list">
          <div className="header">
            <a name="new" href="#upcoming">
              New
            </a>
          </div>
          <Games url={newGamesUrl} sort="desc" />
        </div>

        <div className="list">
          <div className="header">
            <a name="upcoming" href="#new">
              Upcoming
            </a>
          </div>
          <Games url={upcomingGamesUrl} sort="asc" />
        </div>
      </div>
    )
  }
}

export default App
