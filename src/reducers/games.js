import { assoc, path, toUpper } from 'ramda'
import localStorage from '../modules/localStorage'

const initialState = {
  newGames: localStorage.getItem('newGames'),
  discountedGames: localStorage.getItem('discountedGames'),
  upcomingGames: localStorage.getItem('upcomingGames'),
  plusGames: localStorage.getItem('plusGames')
}

const gamesReducer = (partialState = initialState, action = {}) => {
  switch (action.type) {
    case 'STORE_NEW_GAMES':
      return assoc('newGames', action.value, partialState)
    case 'STORE_DISCOUNTED_GAMES':
      return assoc('discountedGames', action.value, partialState)
    case 'STORE_UPCOMING_GAMES':
      return assoc('upcomingGames', action.value, partialState)
    case 'STORE_PLUS_GAMES':
      return assoc('plusGames', action.value, partialState)
    case 'STORE_SEARCH_GAMES':
      return assoc('searchGames', action.value, partialState)
    default:
      return partialState
  }
}

export const getGamesFromState = (label, state) =>
  path(['games', `${label}Games`], state)

export const setGamesToState = (label, value, dispatch) => {
  dispatch({ type: `STORE_${toUpper(label)}_GAMES`, value })

  localStorage.setItem(`${label}Games`, value)
}

export default gamesReducer
