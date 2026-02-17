import { useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { getSearchQuery } from '../lib/search'
import { searchGames } from '../modules/psnStore'
import Games from './Games'
import ScrollToTopOnMount from './ScrollToTopOnMount'

const SearchResults = () => {
  const location = useLocation()
  const searchString = useMemo(() => getSearchQuery(location.search), [location.search])
  const fetch = useCallback(() => searchGames(searchString), [searchString])

  return (
    <>
      <ScrollToTopOnMount />
      {searchString ? (
        <Games
          key={searchString}
          label="search"
          fetch={fetch}
          showFilters={false}
          emptyMessage={`No games found for "${searchString}"`}
        />
      ) : (
        <div className="games--search-empty">Use search in the top bar to find games.</div>
      )}
    </>
  )
}

export default SearchResults
