import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetWarnOnceForTests,
  conceptToGame,
  isConceptDiscounted,
  isConceptPlus,
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
    afterEach(() => {
      __resetWarnOnceForTests()
      vi.restoreAllMocks()
    })

    it('returns Sony upsellText verbatim when PS_PLUS branding is present', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const game = conceptToGame({
        id: 'concept-id',
        price: {
          basePrice: '€30',
          discountedPrice: '€30',
          upsellServiceBranding: ['PS_PLUS'],
          upsellText: 'Säästä 10 %',
        },
        products: [{ id: 'prod-id' }],
      })

      expect(game.plusUpsellText).toBe('Säästä 10 %')
      expect(warn).not.toHaveBeenCalled()
    })

    it('returns null and warns once when PS_PLUS branding has empty-string upsellText', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
      expect(warn).toHaveBeenCalledTimes(1)
      const firstCall = warn.mock.calls[0]
      if (!firstCall) {
        throw new Error('expected console.warn to have been called')
      }
      const [payload] = firstCall as [unknown]
      expect(typeof payload).toBe('string')
      const parsed: unknown = JSON.parse(String(payload))
      expect(parsed).toEqual({
        source: 'mapper',
        kind: 'plus_upsell_drift',
        signature: 'empty-upsell-text',
        productId: 'prod-empty',
      })
    })

    it('returns null without warning when PS_PLUS branding is absent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const game = conceptToGame({
        id: 'concept-id',
        price: {
          basePrice: '€30',
          discountedPrice: '€30',
          upsellServiceBranding: ['NONE'],
          upsellText: 'Säästä 10 %',
        },
        products: [{ id: 'prod-no-plus' }],
      })

      expect(game.plusUpsellText).toBeNull()
      expect(warn).not.toHaveBeenCalled()
    })

    it('dedupes drift warnings per process and resets via test helper', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const driftConcept = {
        id: 'concept-id',
        price: {
          basePrice: '€30',
          discountedPrice: '€30',
          upsellServiceBranding: ['PS_PLUS'],
          upsellText: '',
        },
        products: [{ id: 'prod-empty' }],
      }

      conceptToGame(driftConcept)
      conceptToGame(driftConcept)
      expect(warn).toHaveBeenCalledTimes(1)

      __resetWarnOnceForTests()
      conceptToGame(driftConcept)
      expect(warn).toHaveBeenCalledTimes(2)
    })
  })
})
