import { fetchWishlistGames } from './psnStore'
import { signedInQueryOptions, WISHLIST_QUERY_KEY } from './signedInQuery'

export const wishlistQueryOptions = signedInQueryOptions(
  WISHLIST_QUERY_KEY,
  fetchWishlistGames,
)
