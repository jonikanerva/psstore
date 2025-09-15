import { Fragment } from 'react'
import queryString from 'query-string'
import Games from './Games'
import SearchField from './SearchField'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import Navigation from './Navigation'
import { searchGames, Game } from '../modules/psnStore'
import { useLocation } from 'react-router-dom'

const SearchResults = () => {
  const location = useLocation()
  const parsed = queryString.parse(location.search)
  const q = (parsed as Record<string, unknown>).q
  const searchString: string = typeof q === 'string' ? q : ''
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
