import { describe, expect, it } from 'vitest'
import { conceptToGame, isConceptDiscounted, isConceptPlus } from '../sony/mapper.js'

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
})
