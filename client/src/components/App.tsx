import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import {
  fetchDiscountedGames,
  fetchNewGames,
  fetchPlusGames,
  fetchUpcomingGames,
} from '../modules/psnStore'
import Details from './Details'
import Games from './Games'
import SearchResults from './SearchResults'
import './App.css'

const RedirectNew = () => <Navigate to="/new" replace />

const App = () => (
  <Router>
    <Routes>
      <Route path="/new" element={<Games label="new" fetch={fetchNewGames} />} />
      <Route
        path="/discounted"
        element={<Games label="discounted" fetch={fetchDiscountedGames} />}
      />
      <Route
        path="/upcoming"
        element={<Games label="upcoming" fetch={fetchUpcomingGames} />}
      />
      <Route path="/plus" element={<Games label="plus" fetch={fetchPlusGames} />} />
      <Route path="/g/:gameId" element={<Details />} />
      <Route path="/search" element={<SearchResults />} />
      <Route path="*" element={<RedirectNew />} />
    </Routes>
  </Router>
)

export default App
