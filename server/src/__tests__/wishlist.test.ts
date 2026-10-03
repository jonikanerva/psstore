import { describe, expect, it } from 'vitest'
import { mapWishlistToGames } from '../domain/library.js'
import { parseWishlist } from '../sony/wishlistSchema.js'

const PRODUCT = 'EP0001-PPSA00001_00-SYNTHETICALPHA00'
const PRODUCT_TWO = 'EP0001-PPSA00002_00-SYNTHETICBETA000'
const IMAGE = { url: 'https://img.test/x.png' }

const entry = (
  overrides: Record<string, unknown>,
): Record<string, unknown> => ({
  __typename: 'Product',
  id: PRODUCT,
  name: 'Synthetic Alpha',
  platforms: ['PS5'],
  boxArt: IMAGE,
  price: { basePrice: '€10,00' },
  ...overrides,
})

const envelope = (list: unknown): unknown => ({
  data: { storeWishlistSecure: list },
})

const ok = (json: unknown) => {
  const outcome = parseWishlist(json)
  if (outcome.kind !== 'ok') {
    throw new Error(`expected ok, got ${outcome.kind}`)
  }
  return outcome
}

describe('parseWishlist', () => {
  it('keeps a PS5-only product and maps the image', () => {
    const outcome = ok(envelope([entry({})]))
    expect(outcome.entries).toEqual([
      {
        id: PRODUCT,
        idKind: 'product',
        name: 'Synthetic Alpha',
        imageUrl: IMAGE.url,
      },
    ])
    expect(outcome.dropped + outcome.outOfScope).toBe(0)
  })

  it('keeps a PS4 + PS5 product and a PS5 concept', () => {
    const outcome = ok(
      envelope([
        entry({ platforms: ['PS4', 'PS5'] }),
        entry({ __typename: 'Concept', id: '10000001', name: 'Concept' }),
      ]),
    )
    expect(outcome.entries.map((e) => e.idKind)).toEqual(['product', 'concept'])
  })

  it('drops out-of-scope entries by default and counts them', () => {
    const outcome = ok(
      envelope([
        entry({ platforms: ['PS4'] }),
        entry({ platforms: [] }),
        entry({ platforms: null }),
        entry({ platforms: undefined }),
        entry({ __typename: 'Concept', id: '10000001', platforms: [] }),
        entry({ __typename: 'Other' }),
        entry({ __typename: null }),
        entry({ __typename: 'Product', id: '10000001' }),
        entry({ __typename: 'Concept', id: PRODUCT }),
        entry({ id: PRODUCT_TWO, platforms: ['PS5'] }),
      ]),
    )
    expect(outcome.entries.map((e) => e.id)).toEqual([PRODUCT_TWO])
    expect(outcome.outOfScope).toBe(9)
    expect(outcome.rawCount).toBe(10)
  })

  it('drops entries without a usable name or id and counts them', () => {
    const outcome = ok(
      envelope([
        entry({ name: '' }),
        entry({ name: null }),
        entry({ id: '' }),
        entry({ id: null }),
        'not an object',
        null,
        entry({ platforms: 'PS5' }),
        entry({ id: PRODUCT_TWO }),
      ]),
    )
    expect(outcome.entries.map((e) => e.id)).toEqual([PRODUCT_TWO])
    expect(outcome.dropped).toBe(7)
    expect(outcome.outOfScope).toBe(0)
  })

  it('keeps the first of duplicate ids in Sony order', () => {
    const outcome = ok(
      envelope([
        entry({ name: 'First' }),
        entry({ id: PRODUCT_TWO }),
        entry({ name: 'Second' }),
      ]),
    )
    expect(outcome.entries.map((e) => e.name)).toEqual([
      'First',
      'Synthetic Alpha',
    ])
  })

  it('accepts an entry without box art', () => {
    expect(ok(envelope([entry({ boxArt: null })])).entries[0]?.imageUrl).toBe(
      '',
    )
    expect(ok(envelope([entry({ boxArt: [] })])).entries[0]?.imageUrl).toBe('')
  })

  it('treats an empty list as an empty wishlist, not as drift', () => {
    expect(ok(envelope([]))).toMatchObject({ entries: [], rawCount: 0 })
  })

  it('reports access denied only for a denied answer with a null list', () => {
    const denied = {
      errors: [{ message: 'Access denied! You need to be authorized.' }],
      data: { storeWishlistSecure: null },
    }
    expect(parseWishlist(denied).kind).toBe('denied')
    expect(
      parseWishlist({
        errors: [{ message: 'access DENIED' }],
        data: { storeWishlistSecure: null },
      }).kind,
    ).toBe('denied')
  })

  it('reports drift for null or missing envelopes without a denial', () => {
    for (const json of [
      { data: { storeWishlistSecure: null } },
      { data: {} },
      { data: null },
      {},
      null,
      'x',
      { data: { storeWishlistSecure: {} } },
      { errors: [{ message: 'Something else' }], data: null },
      { errors: [{ message: 'Access denied' }], data: null },
      { errors: [{ message: 'Access denied' }] },
      { errors: [{ message: 'Access denied' }], data: {} },
      {
        errors: [{ message: 'Access denied' }],
        data: { storeWishlistSecure: {} },
      },
    ]) {
      expect(parseWishlist(json).kind, JSON.stringify(json)).toBe('drift')
    }
  })
})

describe('mapWishlistToGames', () => {
  it('maps name and image only, with empty prices, in Sony order', () => {
    const games = mapWishlistToGames([
      { id: '10000001', idKind: 'concept', name: 'B', imageUrl: 'b' },
      { id: PRODUCT, idKind: 'product', name: 'A', imageUrl: 'a' },
    ])
    expect(games.map((g) => g.name)).toEqual(['B', 'A'])
    expect(games[0]).toMatchObject({
      id: '10000001',
      idKind: 'concept',
      url: 'b',
      price: '',
      originalPrice: '',
      discountText: '',
      plusOffer: null,
    })
    expect(games[1]?.idKind).toBe('product')
  })
})
