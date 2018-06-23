import * as R from 'ramda'
import axios from 'axios'

const parseGames = R.compose(
  R.map(game => ({
    name: R.prop('name', game),
    date: R.prop('release-date', game),
    url: R.prop('thumbnail-url-base', game),
    id: R.prop('id', game),
    price: R.path(
      ['prices', 'plus-user', 'actual-price', 'display'],
      R.head(R.propOr([], 'skus', game))
    )
  })),
  R.map(R.prop('attributes')),
  R.map(data => R.assocPath(['attributes', 'id'], R.prop('id', data), data)),
  R.filter(R.propEq('type', 'game')),
  R.pathOr([], ['data', 'included'])
)

export const fetchGames = url => axios.get(url).then(parseGames)
