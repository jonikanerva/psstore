import { compose, filter, head, map, pathOr, propEq } from 'ramda'
import axios from 'axios'

const createGameObject = game => {
  const skus = head(pathOr([], ['attributes', 'skus'], game))

  return {
    name: pathOr('', ['attributes', 'name'], game),
    date: pathOr('', ['attributes', 'release-date'], game),
    url: pathOr('', ['attributes', 'thumbnail-url-base'], game),
    id: pathOr('', ['id'], game),
    price: pathOr('', ['prices', 'plus-user', 'actual-price', 'display'], skus),
    discountDate: pathOr(
      '1975-01-01T00:00:00Z',
      ['prices', 'plus-user', 'availability', 'start-date'],
      skus
    )
  }
}

const parseGames = compose(
  map(createGameObject),
  filter(propEq('type', 'game')),
  pathOr([], ['data', 'included'])
)

export const fetchGames = url => axios.get(url).then(parseGames)
