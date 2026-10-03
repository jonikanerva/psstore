import type { Game } from '@psstore/shared'
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

// The id is always the product id: the internal game page resolves product ids.
export const mapPurchasedToGames = (
  entries: readonly PurchasedEntry[],
): Game[] =>
  entries.map((entry) =>
    libraryCard(entry.productId, entry.name, entry.imageUrl, 'product'),
  )
// `idKind` comes from the entry: the wishlist boundary has already checked the
// id against it.
const wishlistCard = (entry: WishlistEntry): Game =>
  libraryCard(entry.id, entry.name, entry.imageUrl, entry.idKind)

export const mapWishlistToGames = (entries: readonly WishlistEntry[]): Game[] =>
  entries.map(wishlistCard)

// A wishlist card is the public store's game when the store returned one. The
// card keeps the wishlist's id and fills a missing name or cover from the entry.
export const mergeWishlistEntry = (
  entry: WishlistEntry,
  found: Game | null,
): Game =>
  found === null
    ? wishlistCard(entry)
    : {
        ...found,
        id: entry.id,
        name: found.name || entry.name,
        url: found.url || entry.imageUrl,
      }
