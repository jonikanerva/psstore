import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getSearchQuery } from '../lib/search'
import './HeaderSearch.css'

const HeaderSearch = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (location.pathname === '/search') {
      setValue(getSearchQuery(location.search))
    }
  }, [location.pathname, location.search])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = value.trim()

    if (!query) {
      navigate('/search')
      return
    }

    navigate(`/search?q=${encodeURIComponent(query)}`)
  }

  return (
    <form className="header-search" onSubmit={submit}>
      <input
        className="header-search--input"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search games"
        aria-label="Search games"
      />
      <button className="header-search--submit" type="submit">
        Search
      </button>
    </form>
  )
}

export default HeaderSearch
