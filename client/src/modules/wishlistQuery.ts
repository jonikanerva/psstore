import { fetchWishlistGames } from './psnStore'
import { signedInQueryOptions } from './signedInQuery'

export const WISHLIST_QUERY_KEY = ['wishlist'] as const

export const wishlistQueryOptions = signedInQueryOptions(
  WISHLIST_QUERY_KEY,
  fetchWishlistGames,
)
