import * as R from 'ramda'

export const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMENEWTHISMONTH?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=200&bucket=games&start=0'

export const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=200&bucket=games&start=0'

export const discountGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=300&bucket=games&start=0'

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

const sortGames = sort => {
  switch (sort) {
    case 'desc':
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

const fetchUrl = url =>
  fetch(url)
    .then(res => res.json())
    .then(parseGames)

const fetchNewGames = () => fetchUrl(newGamesUrl).then(sortGames('desc'))

const fetchUpcomingGames = () =>
  fetchUrl(upcomingGamesUrl).then(sortGames('asc'))

const fetchDiscountedGames = () =>
  fetchUrl(discountGamesUrl).then(sortGames('discounted'))

const fetchGames = () =>
  Promise.all([
    fetchNewGames(),
    fetchDiscountedGames(),
    fetchUpcomingGames()
  ]).then(([newGames, discountedGames, upcomingGames]) => ({
    newGames,
    discountedGames,
    upcomingGames
  }))

export default fetchGames
