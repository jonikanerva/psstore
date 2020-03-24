import React from 'react'
import queryString from 'query-string'
import * as R from 'ramda'
import Games from './Games'
import SearchField from './SearchField'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Navigation from './Navigation'
import { searchGames } from '../modules/psnStore'

const SearchResults = (props) => {
  const searchString = R.prop('q', queryString.parse(props.location.search))

  return (
    <React.Fragment>
      <ScrollToTopOnMount />
      <Navigation />
      <SearchField label="search" linkto="search" searchString={searchString} />

      {searchString && (
        <Games
          label="search"
          linkto="field"
          fetch={() => searchGames(searchString)}
        />
      )}
    </React.Fragment>
  )
}

export default SearchResults
