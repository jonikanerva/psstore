import { Outlet } from 'react-router-dom'
import Navigation from './Navigation'
import './AppShell.css'

const AppShell = () => (
  <div className="app-shell">
    <header className="app-shell--header">
      <div className="app-shell--brand">PS Store</div>
      <Navigation />
    </header>
    <main className="app-shell--main">
      <Outlet />
    </main>
  </div>
)

export default AppShell
