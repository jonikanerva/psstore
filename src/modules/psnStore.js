import * as R from 'ramda'

const createGameObject = game => {
  const skus = R.head(R.pathOr([], ['attributes', 'skus'], game))
  const images = R.pathOr([], ['attributes', 'media-list', 'screenshots'], game)
  const videos = R.pathOr([], ['attributes', 'media-list', 'preview'], game)

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
    screenshots: R.map(R.prop('url'), images),
    videos: R.map(R.prop('url'), videos),
    genres: R.join(', ', R.pathOr([], ['attributes', 'genres'], game)),
    description: R.pathOr('', ['attributes', 'long-description'], game),
    studio: R.pathOr('', ['attributes', 'provider-name'], game)
  }
}

const sortGames = label => {
  switch (label) {
    case 'new':
      return R.sort(R.descend(R.prop('date')))
    case 'discounted':
      return R.sortWith([
        R.descend(R.prop('discountDate')),
        R.descend(R.prop('date'))
      ])
    default:
      return R.sort(R.ascend(R.prop('date')))
  }
}

const parseGames = R.compose(
  R.map(createGameObject),
  R.filter(R.propEq('type', 'game')),
  R.propOr([], 'included')
)

const fetchGames = (url, label) =>
  fetch(url)
    .then(res => res.json())
    .then(parseGames)
    .then(sortGames(label))

export default fetchGames
