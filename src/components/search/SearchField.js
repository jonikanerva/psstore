import React from 'react'
import './SearchField.css'

const SearchField = () => (
  <div className="searchfield-box">
    <form method="GET" action="/search">
      <input type="text" name="q" />
      <input type="submit" value="Search" />
    </form>
  </div>
)

export default SearchField
