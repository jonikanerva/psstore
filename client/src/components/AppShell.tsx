import { Outlet } from 'react-router-dom'
import HeaderSearch from './HeaderSearch'
import Navigation from './Navigation'
import './AppShell.css'

const AppShell = () => (
  <div className="app-shell">
    <header className="app-shell--header">
      <div className="app-shell--brand">PS5 Catalog</div>
      <Navigation />
      <HeaderSearch />
    </header>
    <main className="app-shell--main">
      <Outlet />
    </main>
  </div>
)

export default AppShell
