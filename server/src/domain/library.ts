import type { Game } from '@psstore/shared'
import type { PurchasedEntry } from '../sony/purchasedSchema.js'

// Pure mapping of the signed-in library to cards. Sony's order is kept: the
// list carries no release date and no price. The id is always the product id:
// the internal game page resolves product ids only.
export const mapPurchasedToGames = (
  entries: readonly PurchasedEntry[],
): Game[] =>
  entries.map((entry): Game => {
    return {
      id: entry.productId,
      name: entry.name,
      date: '',
      url: entry.imageUrl,
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
      idKind: 'product',
    }
  })
