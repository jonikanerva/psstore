import React from 'react'
import Games from './Games'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import SearchField from './SearchField'
import {
  fetchNewGames,
  fetchDiscountedGames,
  fetchUpcomingGames
} from '../modules/psnStore'
import './GamesList.css'

const GamesLists = () => (
  <div className="gameslists">
    <ScrollToTopOnMount />
    <Games label="new" linkto="discounted" fetch={fetchNewGames} />
    <Games label="discounted" linkto="upcoming" fetch={fetchDiscountedGames} />
    <Games label="upcoming" linkto="search" fetch={fetchUpcomingGames} />
    <SearchField label="search" linkto="new" />
  </div>
)

export default GamesLists
