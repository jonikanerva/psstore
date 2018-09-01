import React from 'react'
import './SearchField.css'

const SearchField = ({ label, linkto }) => (
  <div className="searchfield">
    <form method="GET" action="/search">
      <input type="text" name="q" className="searchfield__text" />
      <input type="submit" value="Search" className="searchfield__submit" />
    </form>
    <a name={label} href={`#${linkto}`} className="searchfield__link">
      top
    </a>
  </div>
)

export default SearchField
