import type { Game } from '@psstore/shared'
import type { PurchasedEntry } from '../sony/purchasedSchema.js'

// Pure mapping of the signed-in library to cards. Sony's order is kept: the
// list carries no release date and no price. The id is the concept id when Sony
// gives one, else the product id: the owned SKU can be delisted, and the game
// page resolves a concept id to the SKU Sony sells today. `idKind` stays
// `product` so the card opens the game page.
export const mapPurchasedToGames = (
  entries: readonly PurchasedEntry[],
): Game[] =>
  entries.map((entry): Game => {
    return {
      id: entry.conceptId ?? entry.productId,
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
