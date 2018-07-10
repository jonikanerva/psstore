import React from 'react'
import Games from '../games/Games'
import './GamesList.css'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMENEWTHISMONTH?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=100&bucket=games&start=0'

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'

const discountGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=80&bucket=games&start=0'

const GamesLists = props => (
  <div className="gameslist-parent">
    <div className="gameslist-list">
      <a name="new" href="#discounted">
        <div className="gameslist-header">New</div>
      </a>
      <Games url={newGamesUrl} sort="desc" />
    </div>

    <div className="gameslist-list">
      <a name="discounted" href="#upcoming">
        <div className="gameslist-header">Discounted</div>
      </a>
      <Games url={discountGamesUrl} sort="discount" />
    </div>

    <div className="gameslist-list">
      <a name="upcoming" href="#new">
        <div className="gameslist-header">Upcoming</div>
      </a>
      <Games url={upcomingGamesUrl} sort="asc" />
    </div>
  </div>
)

export default GamesLists
