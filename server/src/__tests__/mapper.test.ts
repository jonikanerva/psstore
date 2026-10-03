import { describe, expect, it } from 'vitest'
import {
  conceptToGame,
  isConceptDiscounted,
  isConceptPlus,
  productDetailToGame,
} from '../sony/mapper.js'

describe('concept mapper', () => {
  it('maps sony concept to app game', () => {
    const game = conceptToGame({
      id: 'concept-id',
      name: 'Game',
      media: [{ type: 'IMAGE', role: 'MASTER', url: 'https://img' }],
      price: {
        basePrice: '€70',
        discountedPrice: '€50',
        discountText: 'sale',
        serviceBranding: ['NONE'],
      },
      products: [
        {
          id: 'prod-id',
          releaseDate: '2027-01-01T00:00:00Z',
          providerName: 'Studio',
          genres: ['Action'],
        },
      ],
    })

    expect(game.id).toBe('prod-id')
    expect(game.url).toBe('https://img')
    expect(game.price).toBe('€50')
    expect(game.genres).toEqual(['Action'])
    expect(game.preOrder).toBe(true)
  })

  it('prefers cover-art roles over screenshots for card image', () => {
    const game = conceptToGame({
      id: 'concept-id',
      name: 'Game',
      media: [
        { type: 'IMAGE', role: 'SCREENSHOT', url: 'https://img/screenshot' },
        { type: 'IMAGE', role: 'GAMEHUB_COVER_ART', url: 'https://img/cover' },
      ],
      price: { basePrice: '€70', discountedPrice: '€70' },
      products: [{ id: 'prod-id' }],
    })

    expect(game.url).toBe('https://img/cover')
    expect(game.screenshots).toContain('https://img/screenshot')
  })

  it('does not emit fake 1975 release date when source date is missing', () => {
    const game = conceptToGame({
      id: 'concept-id',
      name: 'Game',
      media: [{ type: 'IMAGE', role: 'MASTER', url: 'https://img' }],
      price: { basePrice: '€70', discountedPrice: '€70' },
      products: [{ id: 'prod-id' }],
    })

    expect(game.date).toBe('')
    expect(game.preOrder).toBe(false)
  })

  it('detects plus and discounted flags from concept price metadata', () => {
    const concept = {
      id: 'concept-id',
      price: {
        basePrice: '€30',
        discountedPrice: '€20',
        discountText: 'save',
        serviceBranding: ['PS_PLUS'],
      },
    }

    expect(isConceptDiscounted(concept)).toBe(true)
    expect(isConceptPlus(concept)).toBe(true)
  })

  describe('plusUpsellText', () => {
    it('returns Sony upsellText verbatim when PS_PLUS branding is present', () => {
      const game = conceptToGame({
        id: 'concept-id',
        price: {
          basePrice: '€30',
          discountedPrice: '€30',
          upsellServiceBranding: ['PS_PLUS'],
          upsellText: 'Save 10%',
        },
        products: [{ id: 'prod-id' }],
      })

      expect(game.plusUpsellText).toBe('Save 10%')
    })

    it('returns null when PS_PLUS branding has empty-string upsellText', () => {
      const game = conceptToGame({
        id: 'concept-id',
        price: {
          basePrice: '€30',
          discountedPrice: '€30',
          upsellServiceBranding: ['PS_PLUS'],
          upsellText: '',
        },
        products: [{ id: 'prod-empty' }],
      })

      expect(game.plusUpsellText).toBeNull()
    })

    it('returns null when PS_PLUS branding is absent', () => {
      const game = conceptToGame({
        id: 'concept-id',
        price: {
          basePrice: '€30',
          discountedPrice: '€30',
          upsellServiceBranding: ['NONE'],
          upsellText: 'Save 10%',
        },
        products: [{ id: 'prod-no-plus' }],
      })

      expect(game.plusUpsellText).toBeNull()
    })
  })
})

describe('productDetailToGame', () => {
  const ID = 'EP0002-PPSA02410_00-DESTINYTHEGAME02'
  const detail = {
    name: 'Destiny 2',
    media: [
      { type: 'IMAGE', role: 'GAMEHUB_COVER_ART', url: 'https://img/cover' },
      { type: 'IMAGE', role: 'SCREENSHOT', url: 'https://img/shot' },
      { type: 'VIDEO', role: 'PREVIEW', url: 'https://vid/preview.mp4' },
    ],
    releaseDate: '2019-10-01T00:00:00+02:00',
    genres: ['Action'],
    description: 'Long text',
    publisherName: 'Bungie',
  }

  it('maps detail fields and a standard price to a game', () => {
    const game = productDetailToGame(ID, detail, {
      basePrice: '€39,99',
      discountedPrice: '€19,99',
      discountText: '-50%',
    })

    expect(game).toMatchObject({
      id: ID,
      name: 'Destiny 2',
      date: '2019-09-30T22:00:00.000Z',
      url: 'https://img/cover',
      screenshots: ['https://img/shot'],
      videos: ['https://vid/preview.mp4'],
      genres: ['Action'],
      studio: 'Bungie',
      price: '€19,99',
      originalPrice: '€39,99',
      discountText: '-50%',
      plusUpsellText: null,
      plusOffer: null,
      description: '',
      idKind: 'product',
    })
  })

  it('leaves the price empty without a standard price and the date empty without a release date', () => {
    const game = productDetailToGame(
      ID,
      { media: [], genres: [], description: '' },
      null,
    )

    expect(game.price).toBe('')
    expect(game.originalPrice).toBe('')
    expect(game.date).toBe('')
    expect(game.preOrder).toBe(false)
    expect(game.name).toBe('')
  })
})
