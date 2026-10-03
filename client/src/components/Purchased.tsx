import { purchasedQueryOptions } from '../modules/purchasedQuery'
import SignedInList from './SignedInList'

const Purchased = () => (
  <SignedInList
    query={purchasedQueryOptions}
    label="purchased"
    failureMessage="Failed to load your library"
    emptyMessage="No PS5 games in your library"
  />
)

export default Purchased
