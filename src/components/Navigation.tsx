import { NavLink } from 'react-router-dom'

import './Navigation.css'

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `navigation--link ${isActive ? 'navigation--active' : ''}`

const Navigation = () => (
  <div className="navigation">
    <NavLink to="/new" className={navClass}>
      New
    </NavLink>
    <NavLink to="/upcoming" className={navClass}>
      Upcoming
    </NavLink>
    <NavLink to="/discounted" className={navClass}>
      Discounted
    </NavLink>
    <NavLink to="/plus" className={navClass}>
      Plus
    </NavLink>
    <NavLink to="/search" className={navClass}>
      Search
    </NavLink>
  </div>
)

export default Navigation
