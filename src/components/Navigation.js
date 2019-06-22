import React from 'react'
import { NavLink } from 'react-router-dom'

import './Navigation.css'

const Navigation = () => (
  <div className="navigation">
    <NavLink
      to="/new"
      className="navigation--link"
      activeClassName="navigation--active"
    >
      New
    </NavLink>
    <NavLink
      to="/upcoming"
      className="navigation--link"
      activeClassName="navigation--active"
    >
      Upcoming
    </NavLink>
    <NavLink
      to="/discounted"
      className="navigation--link"
      activeClassName="navigation--active"
    >
      Discounted
    </NavLink>
  </div>
)

export default Navigation
