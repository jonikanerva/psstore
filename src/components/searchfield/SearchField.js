import React from 'react'
import './SearchField.css'

const SearchField = ({ label, linkto }) => (
  <div className="searchfield">
    <a name={label} href={`#${linkto}`} className="searchfield__link">
      <div className="games--header">{label}</div>
    </a>
    <form method="GET" action="/search">
      <input type="text" name="q" className="searchfield__text" />
      <input type="submit" value="Search" className="searchfield__submit" />
    </form>
  </div>
)

export default SearchField
