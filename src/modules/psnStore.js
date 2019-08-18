import * as R from 'ramda'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMENEWTHISMONTH?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=200&bucket=games&start=0'

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=200&bucket=games&start=0'

const discountGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=300&bucket=games&start=0'

const plusGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PLUSINSTANTGAME?size=30&bucket=games&start=0'

const gameUrl = gameId =>
  `https://store.playstation.com/valkyrie-api/en/FI/999/resolve/${gameId}`

const searchGamesUrl = string =>
  `https://store.playstation.com/valkyrie-api/en/FI/999/bucket-search/${encodeURIComponent(
    string
  )}?size=50&bucket=games`

export const searchLink = string =>
  `https://www.metacritic.com/search/game/${encodeURI(
    string
  )}/results?plats%5B72496%5D=1&search_type=advanced&sort=recent`

const createGameObject = game => {
  const attributes = R.propOr({}, 'attributes', game)
  const prices = R.pathOr({}, ['skus', 0, 'prices', 'plus-user'], attributes)
  const images = R.pathOr([], ['media-list', 'screenshots'], attributes)
  const videos = R.pathOr([], ['media-list', 'preview'], attributes)
  const defaultTime = '1975-01-01T00:00:00Z'

  const ob = {
    name: R.propOr('', 'name', attributes),
    date: R.propOr('', 'release-date', attributes),
    url: R.propOr('', 'thumbnail-url-base', attributes),
    id: R.propOr('', 'id', game),
    price: R.pathOr('', ['actual-price', 'display'], prices),
    discountDate: R.pathOr(defaultTime, ['availability', 'start-date'], prices),
    screenshots: R.map(R.prop('url'), images),
    videos: R.map(R.prop('url'), videos),
    genres: R.join(', ', R.propOr([], 'genres', attributes)),
    description: R.propOr('', 'long-description', attributes),
    studio: R.propOr('', 'provider-name', attributes)
  }

  return ob
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

export const fetchNewGames = () => fetchUrl(newGamesUrl).then(sortGames('desc'))

export const fetchUpcomingGames = () =>
  fetchUrl(upcomingGamesUrl).then(sortGames('asc'))

export const fetchDiscountedGames = () =>
  fetchUrl(discountGamesUrl).then(sortGames('discounted'))

export const fetchPlusGames = () =>
  fetchUrl(plusGamesUrl).then(sortGames('desc'))

export const searchGames = searchString =>
  fetchUrl(searchGamesUrl(searchString)).then(sortGames('desc'))

export const fetchGame = gameId => fetchUrl(gameUrl(gameId))
