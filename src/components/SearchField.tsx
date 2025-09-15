import { useState, useEffect, ChangeEvent } from 'react'

import './SearchField.css'

interface SearchFieldProps {
  searchString: string
}

const SearchField = ({ searchString }: SearchFieldProps) => {
  const [value, setValue] = useState<string>()

  useEffect(() => setValue(searchString), [searchString])

  return (
    <div className="searchfield">
      <div className="searchfield--form">
        <form method="GET" action="/search">
          <input
            autoFocus
            type="text"
            value={value}
            name="q"
            onChange={(e: ChangeEvent<HTMLInputElement>): void =>
              setValue(e.target.value)
            }
            className="searchfield--text"
          />
          <input type="submit" value="Search" className="searchfield--submit" />
        </form>
      </div>
    </div>
  )
}
export default SearchField
