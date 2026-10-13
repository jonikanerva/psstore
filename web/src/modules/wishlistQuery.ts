import { fetchWishlistGames } from './psnStore'
import { signedInQueryOptions, WISHLIST_QUERY_KEY } from './signedInQuery'

export const wishlistQueryOptions = signedInQueryOptions(
  WISHLIST_QUERY_KEY,
  // The query context must not reach the fetcher: its argument is an abort signal.
  () => fetchWishlistGames(),
)
