import React, { useState, useEffect } from 'react'

import './SearchField.css'

const SearchField = ({ searchString }) => {
  const [value, setValue] = useState()

  useEffect(() => setValue(searchString), [searchString])

  return (
    <div className="searchfield">
      <div className="searchfield--form">
        <form method="GET" action="/search">
          <input
            autoFocus
            type="text"
            value={value}
            name="q"
            onChange={e => setValue(e.target.value)}
            className="searchfield--text"
          />
          <input type="submit" value="Search" className="searchfield--submit" />
        </form>
      </div>
    </div>
  )
}
export default SearchField
