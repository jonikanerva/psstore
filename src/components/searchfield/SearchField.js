import React from 'react'
import './SearchField.css'

const SearchField = ({ label, linkto }) => (
  <div className="searchfield">
    <form method="GET" action="/search">
      <input type="text" name="q" />
      <input type="submit" value="Search" />
    </form>
    <a name={label} href={`#${linkto}`}>
      top
    </a>
  </div>
)

export default SearchField
