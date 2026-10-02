import { describe, expect, it } from 'vitest'
import { parsePlusOffer } from '../sony/productPriceSchema.js'
import discountPreorder from './fixtures/productPriceDiscountPreorder.golden.json' with { type: 'json' }
import discountReleased from './fixtures/productPriceDiscountReleased.golden.json' with { type: 'json' }
import included from './fixtures/productPriceIncluded.golden.json' with { type: 'json' }
import otherSubscription from './fixtures/productPriceOtherSubscription.golden.json' with { type: 'json' }
import plusOnly from './fixtures/productPricePlusOnly.golden.json' with { type: 'json' }
import trial from './fixtures/productPriceTrial.golden.json' with { type: 'json' }

const wrap = (webctas: unknown): unknown => ({
  data: { productRetrieve: { webctas } },
})

const plusCta = (
  price: Record<string, unknown>,
  type = 'UPSELL_PS_PLUS_DISCOUNT',
) => ({
  type,
  price: {
    applicability: 'UPSELL',
    serviceBranding: ['PS_PLUS'],
    isTiedToSubscription: false,
    discountedPrice: '€10,00',
    ...price,
  },
})

describe('parsePlusOffer on real captures', () => {
  it('returns the verbatim Plus price next to a pre-order CTA', () => {
    expect(parsePlusOffer(discountPreorder)).toEqual({
      kind: 'price',
      price: '€44,95',
    })
  })

  it('returns the verbatim Plus price from the DISCOUNTED view', () => {
    expect(parsePlusOffer(discountReleased)).toEqual({
      kind: 'price',
      price: '€17,95',
    })
  })

  it('returns included for a Plus catalogue game with a standard CTA', () => {
    expect(parsePlusOffer(included)).toEqual({ kind: 'included' })
  })

  it('returns included for a Plus-only product with no standard CTA', () => {
    expect(parsePlusOffer(plusOnly)).toEqual({ kind: 'included' })
  })

  it('returns no offer for a Plus game trial', () => {
    expect(parsePlusOffer(trial)).toBeNull()
  })

  it('never labels another subscription service as PS Plus', () => {
    expect(parsePlusOffer(otherSubscription)).toBeNull()
  })
})

describe('parsePlusOffer on synthetic malformed input', () => {
  it('returns null for non-object, missing and null bodies', () => {
    expect(parsePlusOffer(undefined)).toBeNull()
    expect(parsePlusOffer(null)).toBeNull()
    expect(parsePlusOffer('text')).toBeNull()
    expect(parsePlusOffer({})).toBeNull()
    expect(parsePlusOffer({ data: null })).toBeNull()
    expect(parsePlusOffer({ data: { productRetrieve: null } })).toBeNull()
    expect(parsePlusOffer(wrap(null))).toBeNull()
    expect(parsePlusOffer(wrap([]))).toBeNull()
  })

  it('skips malformed entries and still finds a later valid offer', () => {
    const body = wrap([
      null,
      'text',
      { type: 5, price: 'x' },
      { type: 'UPSELL_PS_PLUS_DISCOUNT', price: null },
      plusCta({}),
    ])
    expect(parsePlusOffer(body)).toEqual({ kind: 'price', price: '€10,00' })
  })

  it('ignores unknown keys and null fields', () => {
    const body = wrap([
      {
        ...plusCta({
          extra: 1,
          history: null,
          serviceBranding: ['PS_PLUS', null],
        }),
        more: [],
      },
    ])
    expect(parsePlusOffer(body)).toEqual({ kind: 'price', price: '€10,00' })
  })

  it('rejects a Plus sale that is not an UPSELL', () => {
    expect(
      parsePlusOffer(wrap([plusCta({ applicability: 'APPLICABLE' })])),
    ).toBeNull()
  })

  it('rejects a sale without PS_PLUS branding', () => {
    expect(
      parsePlusOffer(wrap([plusCta({ serviceBranding: ['NONE'] })])),
    ).toBeNull()
    expect(
      parsePlusOffer(wrap([plusCta({ serviceBranding: null })])),
    ).toBeNull()
  })

  it('rejects an empty or blank Plus price', () => {
    expect(parsePlusOffer(wrap([plusCta({ discountedPrice: '' })]))).toBeNull()
    expect(parsePlusOffer(wrap([plusCta({ discountedPrice: ' ' })]))).toBeNull()
    expect(
      parsePlusOffer(wrap([plusCta({ discountedPrice: null })])),
    ).toBeNull()
  })

  it('rejects a price when the subscription tie is unknown', () => {
    expect(
      parsePlusOffer(wrap([plusCta({ isTiedToSubscription: null })])),
    ).toBeNull()
  })

  it('maps a tied game-catalogue CTA to included and a tied unknown type to nothing', () => {
    const tied = { isTiedToSubscription: true, discountedPrice: 'Included' }
    expect(
      parsePlusOffer(wrap([plusCta(tied, 'UPSELL_PS_PLUS_GAME_CATALOG')])),
    ).toEqual({ kind: 'included' })
    expect(
      parsePlusOffer(wrap([plusCta(tied, 'UPSELL_PS_PLUS_NEW_TYPE')])),
    ).toBeNull()
  })

  it('keeps a non-breaking space in the price verbatim', () => {
    const nbsp = '10,00 €'
    expect(parsePlusOffer(wrap([plusCta({ discountedPrice: nbsp })]))).toEqual({
      kind: 'price',
      price: nbsp,
    })
  })
})
