import React, { Fragment } from 'react'
import queryString from 'query-string'
import * as R from 'ramda'
import Games from './Games'
import SearchField from './SearchField'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Navigation from './Navigation'
import { searchGames, Game } from '../modules/psnStore'
import { RouteComponentProps } from 'react-router-dom'

const SearchResults = (props: RouteComponentProps): JSX.Element => {
  const searchString: string = R.propOr(
    '',
    'q',
    queryString.parse(props.location.search)
  )
  const fetch = (): Promise<Game[]> => searchGames(searchString)

  return (
    <Fragment>
      <ScrollToTopOnMount />
      <Navigation />
      <SearchField searchString={searchString} />

      {searchString && <Games label="search" fetch={fetch} />}
    </Fragment>
  )
}

export default SearchResults
