import React from 'react'
import Loading from './Spinner'

import './Header.css'

const Header = ({ label, linkto, loading }) => (
  <a name={label} href={`#${linkto}`} className="header--list__link">
    <div className="header--header">
      {label} Games
      <div className="header--header-loading">
        <Loading loading={loading} />
      </div>
    </div>
  </a>
)

export default Header
