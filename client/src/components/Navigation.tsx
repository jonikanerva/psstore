import { NavLink } from 'react-router-dom'

import './Navigation.css'

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `navigation--link ${isActive ? 'navigation--active' : ''}`

const Navigation = () => (
  <nav className="navigation" aria-label="Top navigation">
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
  </nav>
)

export default Navigation
