import { describe, expect, it } from 'vitest'
import {
  parsePlusOffer,
  parseProductPrice,
} from '../sony/productPriceSchema.js'
import discountPreorder from './fixtures/productPriceDiscountPreorder.golden.json' with { type: 'json' }
import classic from './fixtures/productPriceClassic.golden.json' with { type: 'json' }
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

  it('returns included for a PS Plus Premium Classic', () => {
    expect(parsePlusOffer(classic)).toEqual({ kind: 'included' })
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

describe('parseProductPrice', () => {
  const cta = (
    price: Record<string, unknown>,
    type = 'ADD_TO_CART',
  ): unknown => ({
    type,
    price: {
      applicability: 'APPLICABLE',
      basePrice: '€39,99',
      discountedPrice: '€39,99',
      displayDiscountText: null,
      isTiedToSubscription: false,
      serviceBranding: ['NONE'],
      ...price,
    },
  })

  it('reads the standard price next to a Plus discount on real captures', () => {
    expect(parseProductPrice(discountReleased)).toEqual({
      plusOffer: { kind: 'price', price: '€17,95' },
      standard: {
        basePrice: '€19,95',
        discountedPrice: '€19,95',
        discountText: '',
      },
    })
    expect(parseProductPrice(discountPreorder).standard).toEqual({
      basePrice: '€49,95',
      discountedPrice: '€49,95',
      discountText: '',
    })
  })

  it('reads a real standard sale from the trial capture', () => {
    expect(parseProductPrice(trial)).toEqual({
      plusOffer: null,
      standard: {
        basePrice: '€4,95',
        discountedPrice: '€3,96',
        discountText: '',
      },
    })
  })

  it('has no standard price when only subscription CTAs exist', () => {
    expect(parseProductPrice(included).plusOffer).toEqual({ kind: 'included' })
    expect(parseProductPrice(plusOnly)).toEqual({
      plusOffer: { kind: 'included' },
      standard: null,
    })
    expect(parseProductPrice(otherSubscription)).toEqual({
      plusOffer: null,
      standard: null,
    })
  })

  it('has no standard price without webctas or on a malformed body', () => {
    const none = { plusOffer: null, standard: null }
    expect(parseProductPrice(wrap(undefined))).toEqual(none)
    expect(parseProductPrice(wrap(null))).toEqual(none)
    expect(parseProductPrice(wrap([]))).toEqual(none)
    expect(parseProductPrice(null)).toEqual(none)
    expect(parseProductPrice({ data: { productRetrieve: null } })).toEqual(none)
  })

  it('ignores a lone UPSELL CTA', () => {
    expect(parseProductPrice(wrap([plusCta({})])).standard).toBeNull()
  })

  it('reads a normal ADD_TO_CART CTA', () => {
    expect(parseProductPrice(wrap([cta({})])).standard).toEqual({
      basePrice: '€39,99',
      discountedPrice: '€39,99',
      discountText: '',
    })
  })

  it('keeps the Sony strings of a standard sale', () => {
    const body = wrap([
      cta({
        basePrice: '€39,99',
        discountedPrice: '€19,99',
        displayDiscountText: '-50%',
      }),
    ])
    expect(parseProductPrice(body).standard).toEqual({
      basePrice: '€39,99',
      discountedPrice: '€19,99',
      discountText: '-50%',
    })
  })

  it('keeps the Free strings of a free game', () => {
    const body = wrap([
      cta({ basePrice: 'Free', discountedPrice: 'Free' }, 'DOWNLOAD'),
    ])
    expect(parseProductPrice(body).standard).toEqual({
      basePrice: 'Free',
      discountedPrice: 'Free',
      discountText: '',
    })
  })

  it('skips a subscription-tied CTA and a CTA without price strings', () => {
    const body = wrap([
      cta({ isTiedToSubscription: true }),
      cta({ basePrice: null, discountedPrice: null }),
      cta({ basePrice: '€5,00', discountedPrice: '€5,00' }),
    ])
    expect(parseProductPrice(body).standard?.basePrice).toBe('€5,00')
  })
})
