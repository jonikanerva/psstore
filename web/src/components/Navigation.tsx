import { Link, useRouterState } from '@tanstack/react-router'
import { readPdpOrigin, type TabPath } from '../modules/pdpOrigin'

const TABS: readonly { to: TabPath; label: string }[] = [
  { to: '/new', label: 'New' },
  { to: '/upcoming', label: 'Upcoming' },
  { to: '/discounted', label: 'Discounted' },
  { to: '/monthly', label: 'Monthly' },
  { to: '/browse', label: 'Browse' },
  { to: '/wishlist', label: 'Wishlist' },
  { to: '/purchased', label: 'Purchased' },
]

const Navigation = () => {
  // The tab a game page was opened from stays highlighted. The highlight is
  // visual only: the game page is the current page for assistive technology.
  const originPath = useRouterState({
    select: (state) =>
      state.location.pathname.startsWith('/g/')
        ? readPdpOrigin(state.location.state)
        : undefined,
  })

  return (
    <nav className="navigation" aria-label="Top navigation">
      {TABS.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={
            to === originPath
              ? 'navigation--link navigation--origin'
              : 'navigation--link'
          }
          activeProps={{ className: 'navigation--link navigation--active' }}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}

export default Navigation
