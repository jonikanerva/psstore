import { Link } from '@tanstack/react-router'

interface SearchAllCardProps {
  term: string
}

// The last tile of a filtered list. It offers the whole-store search for the
// term in the header field; Enter in the field does the same.
const SearchAllCard = ({ term }: SearchAllCardProps) => (
  <Link to="/search" search={{ q: term }} className="search-all-card">
    Press Enter to search all PS5 games for &quot;{term}&quot;
  </Link>
)

export default SearchAllCard
