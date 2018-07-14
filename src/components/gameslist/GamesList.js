import React from 'react'
import Games from '../games/Games'
import './GamesList.css'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMENEWTHISMONTH?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=100&bucket=games&start=0'

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'

const discountGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=80&bucket=games&start=0'

const Header = ({ label, linkto }) => (
  <a name={label} href={`#${linkto}`}>
    <div className="gameslist-header">{label}</div>
  </a>
)

const GamesLists = props => (
  <div className="gameslist-parent">
    <div className="gameslist-list">
      <Header label="new" linkto="discounted" />
      <Games label="new" url={newGamesUrl} />
    </div>

    <div className="gameslist-list">
      <Header label="discounted" linkto="upcoming" />
      <Games label="discounted" url={discountGamesUrl} />
    </div>

    <div className="gameslist-list">
      <Header label="upcoming" linkto="new" />
      <Games label="upcoming" url={upcomingGamesUrl} />
    </div>
  </div>
)

export default GamesLists
