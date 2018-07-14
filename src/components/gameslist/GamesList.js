import React from 'react'
import Games from '../games/Games'
import './GamesList.css'

const Header = ({ label, linkto }) => (
  <a name={label} href={`#${linkto}`}>
    <div className="gameslist-header">{label}</div>
  </a>
)

const GamesLists = ({ newGames, upcomingGames, discountedGames }) => (
  <div className="gameslist-parent">
    <div className="gameslist-list">
      <Header label="new" linkto="discounted" />
      <Games label="new" games={newGames} />
    </div>

    <div className="gameslist-list">
      <Header label="discounted" linkto="upcoming" />
      <Games label="discounted" games={discountedGames} />
    </div>

    <div className="gameslist-list">
      <Header label="upcoming" linkto="new" />
      <Games label="upcoming" games={upcomingGames} />
    </div>
  </div>
)

export default GamesLists
