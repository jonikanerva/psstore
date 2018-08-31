import React from 'react'
import queryString from 'query-string'
import * as R from 'ramda'
import Games from '../games/Games'
import { searchGames } from '../../modules/psnStore'

const parseQ = props => R.prop('q', queryString.parse(props.location.search))

const SearchResults = props => (
  <Games label="search" linkto="" fetch={() => searchGames(parseQ(props))} />
)

export default SearchResults
