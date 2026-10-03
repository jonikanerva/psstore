import { isValidProductId, type Game } from '@psstore/shared'
import type { PurchasedEntry } from '../sony/purchasedSchema.js'

// Pure mapping of the signed-in library to cards. Sony's order is kept: the
// list carries no release date and no price. The id is the concept id when Sony
// gives one, else the product id; `idKind` follows the id, as in the monthly
// mapper.
export const mapPurchasedToGames = (
  entries: readonly PurchasedEntry[],
): Game[] =>
  entries.map((entry): Game => {
    const id = entry.conceptId ?? entry.productId
    return {
      id,
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
      idKind: isValidProductId(id) ? 'product' : 'concept',
    }
  })
