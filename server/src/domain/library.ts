import type { Game } from '@psstore/shared'
import type { PurchasedEntry } from '../sony/purchasedSchema.js'

// Pure mapping of the signed-in library to cards. Sony's order is kept: the
// list carries no release date and no price. Every card links out to Sony's
// store (`idKind` is always `concept`): the id is the concept id when Sony
// gives one, else the product id, which the client links to the product page.
export const mapPurchasedToGames = (
  entries: readonly PurchasedEntry[],
): Game[] =>
  entries.map((entry): Game => ({
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
    idKind: 'concept',
  }))
