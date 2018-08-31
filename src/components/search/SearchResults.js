import React from 'react'
import Games from '../games/Games'
import { searchGames } from '../../modules/psnStore'

const SearchResults = props => (
  <Games
    label="search"
    linkto=""
    fetch={() => searchGames(props.match.params.search)}
  />
)

export default SearchResults
