import { isValidProductId, type Game } from '@psstore/shared'
import type { PurchasedEntry } from '../sony/purchasedSchema.js'
import type { WishlistEntry } from '../sony/wishlistSchema.js'

// Pure mapping of signed-in lists to cards. Sony's order is kept: the lists
// carry no release date and no price, so those fields stay empty.
const libraryCard = (
  id: string,
  name: string,
  imageUrl: string,
  idKind: Game['idKind'],
): Game => ({
  id,
  name,
  date: '',
  url: imageUrl,
  price: '',
  originalPrice: '',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind,
})

// The id is the concept id when Sony gives one, else the product id; `idKind`
// follows the id, as in the monthly mapper.
export const mapPurchasedToGames = (
  entries: readonly PurchasedEntry[],
): Game[] =>
  entries.map((entry) => {
    const id = entry.conceptId ?? entry.productId
    return libraryCard(
      id,
      entry.name,
      entry.imageUrl,
      isValidProductId(id) ? 'product' : 'concept',
    )
  })

// `idKind` comes from the entry: the wishlist boundary has already checked the
// id against it.
export const mapWishlistToGames = (entries: readonly WishlistEntry[]): Game[] =>
  entries.map((entry) =>
    libraryCard(entry.id, entry.name, entry.imageUrl, entry.idKind),
  )
