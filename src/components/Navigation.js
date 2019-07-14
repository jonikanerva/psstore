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
    <NavLink
      to="/plus"
      className="navigation--link"
      activeClassName="navigation--active"
    >
      Plus
    </NavLink>
    <NavLink
      to="/search"
      className="navigation--link"
      activeClassName="navigation--active"
    >
      Search
    </NavLink>
  </div>
)

export default Navigation
