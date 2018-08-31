import React from 'react'
import Games from '../games/Games'
import { searchGames } from '../../modules/psnStore'

const Search = props => (
  <Games
    label="search"
    linkto=""
    fetch={() => searchGames(props.match.params.search)}
  />
)

export default Search
