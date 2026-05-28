import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navigation from './Navigation'
import './AppShell.css'

export type SearchContext = { readonly query: string }

const AppShell = () => {
  const [query, setQuery] = useState('')
  const location = useLocation()

  useEffect(() => {
    setQuery('')
  }, [location.pathname])

  const context: SearchContext = { query }

  return (
    <div className="app-shell">
      <header className="app-shell--header">
        <div className="app-shell--brand">PS Store</div>
        <Navigation />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="app-shell--search"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value)
          }}
        />
      </header>
      <main className="app-shell--main">
        <Outlet context={context} />
      </main>
    </div>
  )
}

export default AppShell
