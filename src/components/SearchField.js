import React from 'react'
import Header from './Header'

import './SearchField.css'

const SearchField = ({ label, linkto }) => (
  <div className="searchfield">
    <Header label={label} linkto={linkto} loading={false} />

    <div className="searchfield--form">
      <form method="GET" action="/search">
        <input type="text" name="q" className="searchfield--text" />
        <input type="submit" value="Search" className="searchfield--submit" />
      </form>
    </div>
  </div>
)

export default SearchField
