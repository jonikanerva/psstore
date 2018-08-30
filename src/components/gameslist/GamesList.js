import React from 'react'
import Games from '../games/Games'
import Loading from '../spinner/Spinner'
import ScrollToTopOnMount from '../scroll/ScrollToTopOnMount'

import './GamesList.css'

const Header = ({ label, linkto, loading }) => (
  <a name={label} href={`#${linkto}`}>
    <div className="gameslist-header">
      <div>{label}</div>
      <div className="gameslist-header-loading">
        <Loading loading={loading} />
      </div>
    </div>
  </a>
)

const GamesLists = ({ newGames, upcomingGames, discountedGames, loading }) => (
  <div className="gameslist-parent">
    <ScrollToTopOnMount />
    <div className="gameslist-list">
      <Header label="new" linkto="discounted" loading={loading} />
      <Games label="new" games={newGames} />
    </div>

    <div className="gameslist-list">
      <Header label="discounted" linkto="upcoming" loading={loading} />
      <Games label="discounted" games={discountedGames} />
    </div>

    <div className="gameslist-list">
      <Header label="upcoming" linkto="new" loading={loading} />
      <Games label="upcoming" games={upcomingGames} />
    </div>
  </div>
)

export default GamesLists
