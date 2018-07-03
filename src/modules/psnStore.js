import * as R from 'ramda'

const createGameObject = game => {
  const skus = R.head(R.pathOr([], ['attributes', 'skus'], game))
  const images = R.pathOr([], ['attributes', 'media-list', 'screenshots'], game)

  return {
    name: R.pathOr('', ['attributes', 'name'], game),
    date: R.pathOr('', ['attributes', 'release-date'], game),
    url: R.pathOr('', ['attributes', 'thumbnail-url-base'], game),
    id: R.propOr('', 'id', game),
    price: R.pathOr(
      '',
      ['prices', 'plus-user', 'actual-price', 'display'],
      skus
    ),
    discountDate: R.pathOr(
      '1975-01-01T00:00:00Z',
      ['prices', 'plus-user', 'availability', 'start-date'],
      skus
    ),
    screenShots: R.map(R.prop('url'), images)
  }
}

const parseGames = R.compose(
  R.map(createGameObject),
  R.filter(R.propEq('type', 'game')),
  R.propOr([], 'included')
)

export const fetchGames = url =>
  fetch(url)
    .then(res => res.json())
    .then(parseGames)
