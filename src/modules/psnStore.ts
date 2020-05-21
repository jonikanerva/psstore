import * as R from 'ramda'

const newGamesUrl = (start: number): string =>
  `https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-FULLGAMES?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=99&bucket=games&start=${start}`

const upcomingGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'

const discountGamesUrl = (start: number): string =>
  `https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PRICEDROPSCHI?sort=release_date&direction=desc&platform=ps4&game_content_type=games%2Cbundles&size=99&bucket=games&start=${start}`

const plusGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-PLUSINSTANTGAME?size=30&bucket=games&start=0'

const gameUrl = (gameId: string): string =>
  `https://store.playstation.com/valkyrie-api/en/FI/999/resolve/${gameId}`

const searchGamesUrl = (string: string): string =>
  `https://store.playstation.com/valkyrie-api/en/FI/999/bucket-search/${encodeURIComponent(
    string
  )}?size=50&bucket=games`

export const searchLink = (string: string): string =>
  `https://www.metacritic.com/search/game/${encodeURI(
    string
  )}/results?plats%5B72496%5D=1&search_type=advanced&sort=recent`

export interface Game {
  name: string
  date: string
  url: string
  id: string
  price: string
  discountDate: string
  screenshots: string[]
  videos: string[]
  genres: string[]
  description: string
  studio: string
  preOrder: boolean
}

const createGameObject = (game: never): Game => {
  const attributes = R.propOr({}, 'attributes', game)
  const prices = R.pathOr({}, ['skus', 0, 'prices', 'plus-user'], attributes)
  const images = R.pathOr([], ['media-list', 'screenshots'], attributes)
  const videos = R.pathOr([], ['media-list', 'preview'], attributes)
  const defaultTime = '1975-01-01T00:00:00Z'

  const ob: Game = {
    name: R.propOr('', 'name', attributes),
    date: R.propOr('', 'release-date', attributes),
    url: R.propOr('', 'thumbnail-url-base', attributes),
    id: R.propOr('', 'id', game),
    price: R.pathOr('', ['actual-price', 'display'], prices),
    discountDate: R.pathOr(defaultTime, ['availability', 'start-date'], prices),
    screenshots: R.map(R.prop('url'), images) as string[],
    videos: R.map(R.prop('url'), videos) as string[],
    genres: R.propOr([], 'genres', attributes),
    description: R.propOr('', 'long-description', attributes),
    studio: R.propOr('', 'provider-name', attributes),
    preOrder: R.pathOr(false, ['skus', 0, 'is-preorder'], attributes),
  }

  return ob
}

const sortGames = (sort: string, games: Game[]): Game[] => {
  switch (sort) {
    case 'desc':
      return R.sort(R.descend(R.prop('date')), games)
    case 'discounted':
      return R.sortWith(
        [R.descend(R.prop('discountDate')), R.descend(R.prop('date'))],
        games
      )
    default:
      return R.sort(R.ascend(R.prop('date')), games)
  }
}

const fetchUrl = (url: string): Promise<Game[]> =>
  fetch(url)
    .then((res) => res.json())
    .then((json) => R.propOr([], 'included', json))
    .then((obj) => R.filter(R.propEq('type', 'game') as never, obj as never))
    .then((games) => R.map(createGameObject, games as never))

export const fetchNewGames = (): Promise<Game[]> =>
  Promise.all([
    fetchUrl(newGamesUrl(0)),
    fetchUrl(newGamesUrl(99)),
    fetchUrl(newGamesUrl(198)),
    fetchUrl(newGamesUrl(297)),
  ])
    .then(R.flatten)
    .then(R.filter(R.propEq('preOrder', false)) as never)
    .then((games: Game[]) => sortGames('desc', games))

export const fetchUpcomingGames = (): Promise<Game[]> =>
  fetchUrl(upcomingGamesUrl).then((games) => sortGames('asc', games))

export const fetchDiscountedGames = (): Promise<Game[]> =>
  Promise.all([
    fetchUrl(discountGamesUrl(0)),
    fetchUrl(discountGamesUrl(99)),
    fetchUrl(discountGamesUrl(198)),
    fetchUrl(discountGamesUrl(297)),
  ])
    .then(R.flatten)
    .then((games) => sortGames('discounted', games))

export const fetchPlusGames = (): Promise<Game[]> =>
  fetchUrl(plusGamesUrl).then((games) => sortGames('desc', games))

export const searchGames = (searchString: string): Promise<Game[]> =>
  fetchUrl(searchGamesUrl(searchString)).then((games) =>
    sortGames('desc', games)
  )

export const fetchGame = (gameId: string): Promise<Game[]> =>
  fetchUrl(gameUrl(gameId))
