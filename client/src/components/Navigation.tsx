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
    <Link
      to="/monthly"
      className="navigation--link"
      activeProps={{ className: 'navigation--link navigation--active' }}
    >
      Monthly
    </Link>
    <Link
      to="/wishlist"
      className="navigation--link"
      activeProps={{ className: 'navigation--link navigation--active' }}
    >
      Wishlist
    </Link>
    <Link
      to="/purchased"
      className="navigation--link"
      activeProps={{ className: 'navigation--link navigation--active' }}
    >
      Purchased
    </Link>
  </nav>
)

export default Navigation
