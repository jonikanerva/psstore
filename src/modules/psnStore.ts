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
    string,
  )}?size=50&bucket=games`

export const searchLink = (string: string): string =>
  `https://www.metacritic.com/search/game/${encodeURI(
    string,
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

// Minimal API response types
type ApiMedia = { url?: string }
type ApiSku = {
  'is-preorder'?: boolean
  prices?: {
    'plus-user'?: {
      'actual-price'?: { display?: string }
      availability?: { 'start-date'?: string }
    }
  }
}
type ApiAttributes = {
  name?: string
  'release-date'?: string
  'thumbnail-url-base'?: string
  'media-list'?: {
    screenshots?: ApiMedia[]
    preview?: ApiMedia[]
  }
  skus?: ApiSku[]
  genres?: string[]
  'long-description'?: string
  'provider-name'?: string
}
type ApiIncluded = {
  type?: string
  id?: string
  attributes?: ApiAttributes
}
type ApiResponse = { included?: ApiIncluded[] }

const createGameObject = (game: ApiIncluded): Game => {
  const attributes: ApiAttributes = game.attributes || {}
  const plusUser = attributes.skus?.[0]?.prices?.['plus-user']
  const images = attributes['media-list']?.screenshots || []
  const previews = attributes['media-list']?.preview || []
  const defaultTime = '1975-01-01T00:00:00Z'

  const ob: Game = {
    name: attributes.name || '',
    date: attributes['release-date'] || '',
    url: attributes['thumbnail-url-base'] || '',
    id: game.id || '',
    price: plusUser?.['actual-price']?.display || '',
    discountDate: plusUser?.availability?.['start-date'] || defaultTime,
    screenshots: images.map((m) => m.url || '').filter(Boolean) as string[],
    videos: previews.map((m) => m.url || '').filter(Boolean) as string[],
    genres: attributes.genres || [],
    description: attributes['long-description'] || '',
    studio: attributes['provider-name'] || '',
    preOrder: Boolean(attributes.skus?.[0]?.['is-preorder']) || false,
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
        games,
      )
    default:
      return R.sort(R.ascend(R.prop('date')), games)
  }
}

const fetchUrl = async (url: string): Promise<Game[]> => {
  const res = await fetch(url)
  const json = (await res.json()) as ApiResponse
  const included = json.included || []
  const games = included.filter((i) => i && i.type === 'game')
  return games.map(createGameObject)
}

export const fetchNewGames = (): Promise<Game[]> =>
  Promise.all([
    fetchUrl(newGamesUrl(0)),
    fetchUrl(newGamesUrl(99)),
    fetchUrl(newGamesUrl(198)),
    fetchUrl(newGamesUrl(297)),
  ])
    .then((arrs) => arrs.flat())
    .then((arr) => arr.filter((g) => g.preOrder === false))
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
    sortGames('desc', games),
  )

export const fetchGame = (gameId: string): Promise<Game[]> =>
  fetchUrl(gameUrl(gameId))
