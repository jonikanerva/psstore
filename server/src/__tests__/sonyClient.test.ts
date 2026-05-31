import { describe, expect, it } from 'vitest'
import {
  extractCategoryGrid,
  extractProductDetail,
  extractReleaseDateFromProductResponse,
} from '../sony/sonyClient.js'
import { parseProductRetrieve } from '../sony/productDetailSchema.js'
import { buildStrategies } from '../sony/queryStrategies.js'

describe('buildStrategies.new', () => {
  it('filters NEW to PS5 and Sony\'s released "last_thirty_days" facet', () => {
    const variables = buildStrategies().new.buildVariables({})
    expect(variables.filterBy).toEqual([
      'targetPlatforms:PS5',
      'conceptReleaseDate:last_thirty_days',
    ])
  })

  it('keeps NEW sorted conceptReleaseDate descending', () => {
    const variables = buildStrategies().new.buildVariables({})
    expect(variables.sortBy).toEqual({
      name: 'conceptReleaseDate',
      isAscending: false,
    })
  })
})

describe('extractReleaseDateFromProductResponse', () => {
  it('extracts releaseDate from productRetrieve payload', () => {
    const result = extractReleaseDateFromProductResponse({
      data: {
        productRetrieve: {
          id: 'UP0102-PPSA02530_00-PRAGMATA00000000',
          releaseDate: '2026-04-23T21:00:00Z',
        },
      },
    })

    expect(result).toBe('2026-04-23T21:00:00Z')
  })
})

describe('extractProductDetail', () => {
  it('uses the LONG description and maps combinedLocalizedGenres', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'UP0102-PPSA02530_00-PRAGMATA00000000',
          releaseDate: '2026-04-23T21:00:00Z',
          descriptions: [
            { type: 'SHORT', value: 'A tagline.' },
            { type: 'LONG', value: '<p>The long game info body.</p>' },
            { type: 'COMPATIBILITY_NOTICE', value: 'Requires a PS5 console.' },
            { type: 'LEGAL', value: '© Publisher. All rights reserved.' },
          ],
          combinedLocalizedGenres: [
            { value: 'Toiminta' },
            { value: 'Roolipelit' },
          ],
        },
      },
    })

    expect(result.releaseDate).toBe('2026-04-23T21:00:00Z')
    expect(result.description).toBe('<p>The long game info body.</p>')
    expect(result.genres).toEqual(['Toiminta', 'Roolipelit'])
  })

  it('excludes COMPATIBILITY_NOTICE and LEGAL when no LONG/SHORT exists', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'test',
          descriptions: [
            { type: 'COMPATIBILITY_NOTICE', value: 'Requires a PS5 console.' },
            { type: 'LEGAL', value: '© Publisher.' },
          ],
        },
      },
    })

    expect(result.description).toBe('')
  })

  it('falls back to the SHORT description when LONG is missing', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'test',
          descriptions: [{ type: 'SHORT', value: 'Short tagline only.' }],
        },
      },
    })

    expect(result.description).toBe('Short tagline only.')
  })

  it('drops empty genre values', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'test',
          combinedLocalizedGenres: [{ value: 'Toiminta' }, { value: '' }, {}],
        },
      },
    })

    expect(result.genres).toEqual(['Toiminta'])
  })

  it('returns empty defaults when descriptions and genres are missing', () => {
    const result = extractProductDetail({
      data: { productRetrieve: { id: 'test' } },
    })

    expect(result.releaseDate).toBeUndefined()
    expect(result.genres).toEqual([])
    expect(result.description).toBe('')
  })

  it('extracts publisherName from product detail', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'UP4139-PPSA27597_00-STELLARDELUXEPS5',
          releaseDate: '2025-11-11T00:00:00Z',
          publisherName: 'PARADOX GAMES INC',
        },
      },
    })

    expect(result.publisherName).toBe('PARADOX GAMES INC')
  })

  it('returns undefined publisherName when missing', () => {
    const result = extractProductDetail({
      data: { productRetrieve: { id: 'test' } },
    })

    expect(result.publisherName).toBeUndefined()
  })

  it('degrades to empty values when the productRetrieve node is missing', () => {
    const result = extractProductDetail({ data: {} })

    expect(result.releaseDate).toBeUndefined()
    expect(result.genres).toEqual([])
    expect(result.description).toBe('')
  })

  it('tolerates a malformed payload without throwing', () => {
    const malformed = {
      data: {
        productRetrieve: {
          id: 42,
          descriptions: 'not-an-array',
          combinedLocalizedGenres: { value: 'wrong-shape' },
        },
      },
    } as unknown as Parameters<typeof extractProductDetail>[0]

    const result = extractProductDetail(malformed)

    expect(result.releaseDate).toBeUndefined()
    expect(result.genres).toEqual([])
    expect(result.description).toBe('')
  })
})

describe('extractCategoryGrid', () => {
  it('decodes a concepts payload (happy path, concepts-first selection)', () => {
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          concepts: [
            {
              id: '1',
              name: 'Alpha',
              media: [{ type: 'IMAGE', role: 'MASTER', url: 'https://img/a' }],
              price: { basePrice: '€29.95' },
              products: [{ id: 'EP0001-PPSA00001_00-ALPHA00000000000' }],
            },
          ],
          products: [{ id: 'EP0001-PPSA09999_00-IGNORED000000000' }],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      // Concepts win over products when both are present.
      expect(outcome.concepts).toHaveLength(1)
      expect(outcome.concepts[0]?.name).toBe('Alpha')
    }
  })

  it('maps products to concepts when no concepts are present', () => {
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          products: [
            {
              id: 'EP0001-PPSA00002_00-BRAVO00000000000',
              name: 'Bravo',
              media: [],
              price: { basePrice: '€19.95' },
            },
          ],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.concepts).toHaveLength(1)
      expect(outcome.concepts[0]?.name).toBe('Bravo')
      expect(outcome.concepts[0]?.products?.[0]?.id).toBe(
        'EP0001-PPSA00002_00-BRAVO00000000000',
      )
    }
  })

  it('treats a present-but-empty grid as a legitimate empty list (no drift)', () => {
    const empty = extractCategoryGrid({
      data: { categoryGridRetrieve: { concepts: [], products: [] } },
    })
    expect(empty.kind).toBe('ok')
    if (empty.kind === 'ok') {
      expect(empty.concepts).toEqual([])
    }

    const noArrays = extractCategoryGrid({
      data: { categoryGridRetrieve: {} },
    })
    expect(noArrays.kind).toBe('ok')
    if (noArrays.kind === 'ok') {
      expect(noArrays.concepts).toEqual([])
    }
  })

  it('flags an absent categoryGridRetrieve node as drift', () => {
    expect(extractCategoryGrid({ data: {} }).kind).toBe('drift')
    expect(extractCategoryGrid({}).kind).toBe('drift')
    expect(
      extractCategoryGrid({ data: { categoryGridRetrieve: null } }).kind,
    ).toBe('drift')
  })

  it('flags a drift-shaped (malformed) node as drift', () => {
    // concepts is the wrong type — the inner schema rejects it, so the node is
    // undecodable and the caller degrades to [] with a drift warning.
    const malformed = {
      data: {
        categoryGridRetrieve: {
          concepts: 'not-an-array',
          products: 42,
        },
      },
    }
    expect(extractCategoryGrid(malformed).kind).toBe('drift')
  })

  it('flags a non-object body as drift', () => {
    expect(extractCategoryGrid('boom').kind).toBe('drift')
    expect(extractCategoryGrid(null).kind).toBe('drift')
  })

  // ---- Regression: Sony sends `null` liberally (PR #79 emptied the lists) ----
  // These assert the boundary tolerates the REAL null shapes confirmed live
  // against fi-fi. They FAIL on the plain-`optional` schema (the bug) and PASS
  // with `optional(NullOr(...))` + per-element decode.

  it('keeps an UPCOMING concept whose whole price object is null', () => {
    // Real shape: unpriced/announced upcoming games carry `price: null`.
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          concepts: [
            { id: '10018729', name: 'RunNGun', price: null },
            { id: '10019188', name: 'Rat Protocol', price: null },
          ],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.concepts).toHaveLength(2)
      expect(outcome.concepts.map((c) => c.name)).toEqual([
        'RunNGun',
        'Rat Protocol',
      ])
      expect(outcome.dropped).toBe(0)
    }
  })

  it('keeps a DISCOUNTED product whose price.serviceBranding is null', () => {
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          products: [
            {
              id: 'EP0001-PPSA00003_00-DEAL000000000000',
              name: 'Deal',
              price: {
                basePrice: '€59,99',
                discountedPrice: '€39,99',
                serviceBranding: null,
              },
            },
          ],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.concepts).toHaveLength(1)
      expect(outcome.concepts[0]?.name).toBe('Deal')
      expect(outcome.dropped).toBe(0)
    }
  })

  it('decodes a concept with every optional field explicitly null', () => {
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          concepts: [
            {
              id: '99',
              name: null,
              media: null,
              price: null,
              products: null,
            },
          ],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.concepts).toHaveLength(1)
      expect(outcome.dropped).toBe(0)
    }
  })

  it('keeps good concepts and drops only a structurally-broken element', () => {
    // Per-element decode: one good concept + one element that fails its own
    // decode (id is the wrong type). The good one survives; dropped is counted.
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          concepts: [
            { id: '1', name: 'Good', price: null },
            { id: { nope: true }, name: 'Broken' },
          ],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.concepts.map((c) => c.name)).toEqual(['Good'])
      expect(outcome.dropped).toBe(1)
    }
  })

  it('drops a null array element without emptying the grid', () => {
    // `Schema.Array(Unknown)` keeps a null element as `unknown`; the per-element
    // concept decode then rejects null and drops just that slot.
    const outcome = extractCategoryGrid({
      data: {
        categoryGridRetrieve: {
          concepts: [{ id: '1', name: 'Good', price: null }, null],
        },
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.concepts.map((c) => c.name)).toEqual(['Good'])
      expect(outcome.dropped).toBe(1)
    }
  })
})

describe('parseProductRetrieve null tolerance (PR #79 latent defect)', () => {
  it('returns the node when releaseDate / publisherName are null', () => {
    const node = parseProductRetrieve({
      id: 'UP0001-PPSA00001_00-GAME000000000000',
      releaseDate: null,
      publisherName: null,
      storeDisplayClassification: null,
      descriptions: null,
      combinedLocalizedGenres: null,
    })
    expect(node).not.toBeNull()
  })

  it('still returns null for a missing node', () => {
    expect(parseProductRetrieve(null)).toBeNull()
    expect(parseProductRetrieve(undefined)).toBeNull()
  })

  it('drives extractProductDetail to empty values without throwing on null fields', () => {
    const result = extractProductDetail({
      data: {
        productRetrieve: {
          id: 'test',
          releaseDate: null,
          publisherName: null,
        },
      },
    } as unknown as Parameters<typeof extractProductDetail>[0])

    expect(result.releaseDate).toBeUndefined()
    expect(result.publisherName).toBeUndefined()
    expect(result.genres).toEqual([])
  })
})
