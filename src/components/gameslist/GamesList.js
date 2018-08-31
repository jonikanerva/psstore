import React from 'react'
import Games from '../games/Games'
import ScrollToTopOnMount from '../scroll/ScrollToTopOnMount'
import './GamesList.css'

const GamesLists = ({ newGames, upcomingGames, discountedGames, loading }) => (
  <div className="gameslist-container">
    <ScrollToTopOnMount />

    <Games label="new" linkto="discounted" loading={loading} games={newGames} />

    <Games
      label="discounted"
      linkto="upcoming"
      loading={loading}
      games={discountedGames}
    />

    <Games
      label="upcoming"
      linkto="new"
      loading={loading}
      games={upcomingGames}
    />
  </div>
)

export default GamesLists
