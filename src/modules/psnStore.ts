import * as R from 'ramda'

// GraphQL endpoint proxied by Nginx/Vite
const GRAPHQL_ENDPOINT = '/ps-gql'
// Persisted query hash for categoryGridRetrieve
const CATEGORY_GRID_HASH =
  '757de84ff8efb4aeaa78f4faf51bd610bce94a3fcb248ba158916cb88c5cdb7c'

// Category ID for New Games grid (EU). Used as base feed.
const CATEGORY_NEW_GAMES_ID = '12a53448-199e-459b-956d-074feeed2d7d'

type ProductMedia = { url?: string; role?: string; type?: string }
interface ProductPrice {
  basePrice?: string
  discountedPrice?: string
  discountText?: string | null
}
interface Product {
  id?: string
  name?: string
  releaseDate?: string
  media?: ProductMedia[]
  price?: ProductPrice
  genres?: string[]
  providerName?: string
}

const fetchCategoryGrid = async (options: {
  categoryId?: string
  size?: number
  offset?: number
  sortBy?: { name: string; isAscending: boolean }
}): Promise<Product[]> => {
  const { categoryId = CATEGORY_NEW_GAMES_ID, size = 200, offset = 0 } = options
  const sortBy = options.sortBy ?? {
    name: 'productReleaseDate',
    isAscending: false,
  }

  const variables = {
    id: categoryId,
    pageArgs: { size, offset },
    sortBy,
    facetOptions: [],
  }

  const url = `${GRAPHQL_ENDPOINT}?&variables=${encodeURIComponent(
    JSON.stringify(variables),
  )}&extensions=${encodeURIComponent(
    JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: CATEGORY_GRID_HASH },
    }),
  )}`

  const res = await fetch(url, {
    headers: { 'x-apollo-operation-name': 'categoryGridRetrieve' },
  })
  const json = await res.json()
  return R.pathOr(
    [],
    ['data', 'categoryGridRetrieve', 'products'],
    json,
  ) as Product[]
}

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

const createGameObjectFromGql = (product: Product): Game => {
  const defaultTime = '1975-01-01T00:00:00Z'
  const media = (R.propOr([], 'media', product) as ProductMedia[]) || []
  const screenshots = media
    .filter(
      (m) =>
        m?.type === 'IMAGE' &&
        (m?.role === 'SCREENSHOT' || m?.role === 'MASTER'),
    )
    .map((m) => m.url || '')

  const price = (R.propOr({}, 'price', product) as ProductPrice) || {}
  const basePrice = price.basePrice || ''
  const discountedPrice = price.discountedPrice || ''
  const discountText = price.discountText

  const releaseDate: string =
    (R.propOr('', 'releaseDate', product) as string) || ''
  const preOrder = (() => {
    const d = Date.parse(releaseDate)
    return Number.isFinite(d) ? d > Date.now() : false
  })()

  return {
    name: (R.propOr('', 'name', product) as string) || '',
    date: releaseDate,
    url: (screenshots[0] as string) || '',
    id: (R.propOr('', 'id', product) as string) || '',
    price: String(discountedPrice || basePrice || ''),
    discountDate: discountText ? releaseDate || defaultTime : defaultTime,
    screenshots,
    videos: [],
    genres: (R.propOr([], 'genres', product) as string[]) || [],
    description: '',
    studio: (R.propOr('', 'providerName', product) as string) || '',
    preOrder,
  }
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

const fetchCategoryAsGames = async (): Promise<Game[]> => {
  const products = await fetchCategoryGrid({ size: 300, offset: 0 })
  return (products as Product[]).map(createGameObjectFromGql)
}

export const fetchNewGames = async (): Promise<Game[]> => {
  const games = await fetchCategoryAsGames()
  const released = games.filter((g) => !g.preOrder)
  return sortGames('desc', released)
}

export const fetchUpcomingGames = async (): Promise<Game[]> => {
  const games = await fetchCategoryAsGames()
  const upcoming = games.filter((g) => g.preOrder)
  return sortGames('asc', upcoming)
}

export const fetchDiscountedGames = async (): Promise<Game[]> => {
  const games = await fetchCategoryAsGames()
  const discounted = games.filter(
    (g) => g.discountDate !== '1975-01-01T00:00:00Z',
  )
  return sortGames('discounted', discounted)
}

export const fetchPlusGames = async (): Promise<Game[]> => {
  const games = await fetchCategoryAsGames()
  const plus = games.filter((g) => /plus|ps\s*plus/i.test(g.studio || ''))
  return sortGames('desc', plus)
}

export const searchGames = async (searchString: string): Promise<Game[]> => {
  const games = await fetchCategoryAsGames()
  const q = (searchString || '').toLowerCase()
  const filtered = games.filter((g) => g.name.toLowerCase().includes(q))
  return sortGames('desc', filtered)
}

export const fetchGame = async (gameId: string): Promise<Game[]> => {
  const games = await fetchCategoryAsGames()
  return games.filter((g) => g.id === gameId)
}
