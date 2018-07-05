import React, { Component } from 'react'
import Games from '../games/Games'
import './App.css'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMENEWTHISMONTH?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=100&bucket=games&start=0'

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'

const discountGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=80&bucket=games&start=0'

class App extends Component {
  render() {
    return (
      <div className="app-parent">
        <div className="app-list">
          <a name="new" href="#discounted">
            <div className="app-header">New</div>
          </a>
          <Games url={newGamesUrl} sort="desc" />
        </div>

        <div className="app-list">
          <a name="discounted" href="#upcoming">
            <div className="app-header">Discounted</div>
          </a>
          <Games url={discountGamesUrl} sort="discount" />
        </div>

        <div className="app-list">
          <a name="upcoming" href="#new">
            <div className="app-header">Upcoming</div>
          </a>
          <Games url={upcomingGamesUrl} sort="asc" />
        </div>
      </div>
    )
  }
}

export default App
