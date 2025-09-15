import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom'
import Games from './Games'
import Details from './Details'
import SearchResults from './SearchResults'
import {
  fetchNewGames,
  fetchDiscountedGames,
  fetchUpcomingGames,
  fetchPlusGames,
} from '../modules/psnStore'

import './App.css'

const RedirectNew = () => <Navigate to="/new" replace />
const NewGames = () => <Games label="new" fetch={fetchNewGames} />
const DiscountedGames = () => (
  <Games label="discounted" fetch={fetchDiscountedGames} />
)
const UpcomintGames = () => (
  <Games label="upcoming" fetch={fetchUpcomingGames} />
)
const PlusGames = () => <Games label="plus" fetch={fetchPlusGames} />

const App = () => (
  <Router>
    <Routes>
      <Route path="/new" element={<NewGames />} />
      <Route path="/discounted" element={<DiscountedGames />} />
      <Route path="/upcoming" element={<UpcomintGames />} />
      <Route path="/plus" element={<PlusGames />} />
      <Route path="/g/:gameId" element={<Details />} />
      <Route path="/search" element={<SearchResults />} />
      <Route path="*" element={<RedirectNew />} />
    </Routes>
  </Router>
)

export default App
