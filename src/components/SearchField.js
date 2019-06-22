import React from 'react'

import './SearchField.css'

const SearchField = () => (
  <div className="searchfield">
    <div className="searchfield--form">
      <form method="GET" action="/search">
        <input type="text" name="q" className="searchfield--text" />
        <input type="submit" value="Search" className="searchfield--submit" />
      </form>
    </div>
  </div>
)

export default SearchField
