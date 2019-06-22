import React from 'react'
import queryString from 'query-string'
import * as R from 'ramda'
import Games from './Games'
import SearchField from './SearchField'
import { searchGames } from '../modules/psnStore'

const parseQ = props => R.prop('q', queryString.parse(props.location.search))

const SearchResults = props => (
  <div className="searchresults">
    <Games
      label="Found"
      linkto="field"
      fetch={() => searchGames(parseQ(props))}
    />
    <SearchField label="Search" linkto="search" />
  </div>
)

export default SearchResults
