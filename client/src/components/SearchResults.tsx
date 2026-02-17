import { Fragment, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import type { Game } from '../modules/psnStore'
import { getSearchQuery } from '../lib/search'
import { searchGames } from '../modules/psnStore'
import Games from './Games'
import ScrollToTopOnMount from './ScrollToTopOnMount'

const SearchResults = () => {
  const location = useLocation()
  const searchString = useMemo(() => getSearchQuery(location.search), [location.search])
  const fetch = (): Promise<Game[]> => searchGames(searchString)

  return (
    <Fragment>
      <ScrollToTopOnMount />
      {searchString ? (
        <Games
          label="search"
          fetch={fetch}
          showFilters={false}
          emptyMessage={`No games found for "${searchString}"`}
        />
      ) : (
        <div className="games--search-empty">Use search in the top bar to find games.</div>
      )}
    </Fragment>
  )
}

export default SearchResults
