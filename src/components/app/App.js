import React, { Component } from 'react'
import Games from '../games/Games'
import './App.css'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMELATEST?sort=release_date&direction=desc&platform=ps4&game_content_type=games&size=100&bucket=games&start=0'

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'

const discountGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games&size=200&bucket=games&start=0'

class App extends Component {
  render() {
    return (
      <div className="parent">
        <div className="list">
          <a name="new" href="#upcoming">
            <div className="header">New</div>
          </a>
          <Games url={newGamesUrl} sort="desc" />
        </div>

        <div className="list">
          <a name="upcoming" href="#discounted">
            <div className="header">Upcoming</div>
          </a>
          <Games url={upcomingGamesUrl} sort="asc" />
        </div>

        <div className="list">
          <a name="discounted" href="#new">
            <div className="header">Discounted</div>
          </a>
          <Games url={discountGamesUrl} sort="desc" />
        </div>
      </div>
    )
  }
}

export default App
