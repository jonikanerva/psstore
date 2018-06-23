import { compose, filter, head, map, pathOr, propEq } from 'ramda'
import axios from 'axios'

const createGameObject = game => ({
  name: pathOr('', ['attributes', 'name'], game),
  date: pathOr('', ['attributes', 'release-date'], game),
  url: pathOr('', ['attributes', 'thumbnail-url-base'], game),
  id: pathOr('', ['id'], game),
  price: pathOr(
    '',
    ['prices', 'plus-user', 'actual-price', 'display'],
    head(pathOr([], ['attributes', 'skus'], game))
  )
})

const parseGames = compose(
  map(createGameObject),
  filter(propEq('type', 'game')),
  pathOr([], ['data', 'included'])
)

export const fetchGames = url => axios.get(url).then(parseGames)
