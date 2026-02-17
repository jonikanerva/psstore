import { Fragment, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import type { Game } from '../modules/psnStore'
import { getSearchQuery } from '../lib/search'
import { searchGames } from '../modules/psnStore'
import Games from './Games'
import Navigation from './Navigation'
import ScrollToTopOnMount from './ScrollToTopOnMount'
import SearchField from './SearchField'

const SearchResults = () => {
  const location = useLocation()
  const searchString = useMemo(() => getSearchQuery(location.search), [location.search])
  const fetch = (): Promise<Game[]> => searchGames(searchString)

  return (
    <Fragment>
      <ScrollToTopOnMount />
      <Navigation />
      <SearchField searchString={searchString} />
      {searchString && <Games label="search" fetch={fetch} showNavigation={false} />}
    </Fragment>
  )
}

export default SearchResults
