import { wishlistQueryOptions } from '../modules/wishlistQuery'
import SignedInList from './SignedInList'

const Wishlist = () => (
  <SignedInList
    query={wishlistQueryOptions}
    label="wishlist"
    failureMessage="Failed to load your wishlist"
    emptyMessage="No PS5 games on your wishlist"
    showPrice
  />
)

export default Wishlist
