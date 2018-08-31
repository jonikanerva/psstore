import React from 'react'
import Games from '../games/Games'
import ScrollToTopOnMount from '../scroll/ScrollToTopOnMount'
import {
  fetchNewGames,
  fetchDiscountedGames,
  fetchUpcomingGames
} from '../../modules/psnStore'
import './GamesList.css'

const GamesLists = () => (
  <div className="gameslist-container">
    <ScrollToTopOnMount />
    <Games label="new" linkto="discounted" fetch={fetchNewGames} />
    <Games label="discounted" linkto="upcoming" fetch={fetchDiscountedGames} />
    <Games label="upcoming" linkto="new" fetch={fetchUpcomingGames} />
  </div>
)

export default GamesLists
