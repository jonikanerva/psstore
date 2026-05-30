import { Link } from '@tanstack/react-router'

const Navigation = () => (
  <nav className="navigation" aria-label="Top navigation">
    <Link
      to="/new"
      className="navigation--link"
      activeProps={{ className: 'navigation--link navigation--active' }}
    >
      New
    </Link>
    <Link
      to="/upcoming"
      className="navigation--link"
      activeProps={{ className: 'navigation--link navigation--active' }}
    >
      Upcoming
    </Link>
    <Link
      to="/discounted"
      className="navigation--link"
      activeProps={{ className: 'navigation--link navigation--active' }}
    >
      Discounted
    </Link>
  </nav>
)

export default Navigation
