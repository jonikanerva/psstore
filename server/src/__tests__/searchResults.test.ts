import { describe, expect, it } from 'vitest'
import { narrowSearchEntries, type SearchCandidate } from '../domain/listing.js'
import { conceptToGame } from '../sony/mapper.js'
import { parseSearchResponse, type SearchEntry } from '../sony/searchSchema.js'
import { extractProductDetail } from '../sony/sonyClient.js'
import searchGolden from './fixtures/searchResults.golden.json' with { type: 'json' }

const ELDEN = 'EP0700-PPSA04609_00-ELDENRING0000000'
const NIGHTREIGN = 'EP0700-PPSA25381_00-ERSL000000000000'
const SYNTHETIC = 'EP0001-PPSA00001_00-SYNTHETIC0000000'

const product = (
  id: string | null,
  platforms: string[] | null,
  classification: string | null,
): SearchEntry => ({
  kind: 'product',
  product: {
    id,
    name: `Name ${id ?? 'none'}`,
    platforms,
    storeDisplayClassification: classification,
  },
})

const concept = (id: string, productIds: string[]): SearchEntry => ({
  kind: 'concept',
  concept: {
    id,
    name: 'Concept',
    price: null,
    products: productIds.map((p) => ({ id: p })),
  },
})

const ids = (candidates: readonly SearchCandidate[]): string[] =>
  candidates.map((candidate) =>
    candidate.kind === 'known'
      ? (candidate.concept.id ?? '')
      : candidate.productId,
  )

describe('narrowSearchEntries', () => {
  const valid = 'EP0001-PPSA00001_00-AAAAAAAAAAAAAAAA'
  const other = 'EP0001-PPSA00002_00-BBBBBBBBBBBBBBBB'

  it('keeps a PS5 full game and a PS5 bundle', () => {
    const result = narrowSearchEntries([
      product(valid, ['PS4', 'PS5'], 'FULL_GAME'),
      product(other, ['PS5'], 'GAME_BUNDLE'),
    ])

    expect(ids(result)).toEqual([valid, other])
    expect(result.every((candidate) => candidate.kind === 'known')).toBe(true)
  })

  it('drops a PS4-only title', () => {
    expect(narrowSearchEntries([product(valid, ['PS4'], 'FULL_GAME')])).toEqual(
      [],
    )
  })

  it.each(['LEVEL', 'OTHER', 'PREMIUM_EDITION', 'SEASON_PASS', '', null])(
    'drops the non-game classification %s',
    (classification) => {
      expect(
        narrowSearchEntries([product(valid, ['PS5'], classification)]),
      ).toEqual([])
    },
  )

  it('drops a product without platforms, without an id, or with a non-product id', () => {
    expect(
      narrowSearchEntries([
        product(valid, null, 'FULL_GAME'),
        product(null, ['PS5'], 'FULL_GAME'),
        product('10015248', ['PS5'], 'FULL_GAME'),
      ]),
    ).toEqual([])
  })

  it('drops a concept that names no product id', () => {
    expect(
      narrowSearchEntries([
        concept('1', []),
        { kind: 'concept', concept: { id: '2', name: 'x', price: null } },
        concept('3', ['not-a-product-id']),
      ]),
    ).toEqual([])
  })

  it('keeps a concept with a product id as unverified', () => {
    const [candidate] = narrowSearchEntries([concept('1', [valid])])

    expect(candidate).toMatchObject({ kind: 'unverified', productId: valid })
    expect(candidate && conceptToGame(candidate.concept).id).toBe(valid)
  })

  it('keeps Sony order and the first occurrence of a repeated id', () => {
    const result = narrowSearchEntries([
      product(other, ['PS5'], 'FULL_GAME'),
      concept('1', [valid]),
      product(valid, ['PS5'], 'FULL_GAME'),
      product(other, ['PS5'], 'FULL_GAME'),
    ])

    expect(ids(result)).toEqual([other, valid])
    expect(result.map((candidate) => candidate.kind)).toEqual([
      'known',
      'unverified',
    ])
  })
})

describe('parseSearchResponse', () => {
  const envelope = (node: unknown): unknown => ({
    data: { universalSearch: node },
  })

  it('decodes the golden response and counts the elements it cannot read', () => {
    const outcome = parseSearchResponse(searchGolden)

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.isLast).toBe(true)
    // A product with a wrong-typed id and an unknown typename are dropped.
    expect(outcome.dropped).toBe(2)
    expect(outcome.entries).toHaveLength(7)
  })

  it('narrows the golden response to the PS5 games in Sony order', () => {
    const outcome = parseSearchResponse(searchGolden)
    if (outcome.kind !== 'ok') throw new Error('expected ok')

    const candidates = narrowSearchEntries(outcome.entries)

    expect(ids(candidates)).toEqual([ELDEN, NIGHTREIGN, SYNTHETIC])
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      'known',
      'known',
      'unverified',
    ])
  })

  it('tolerates null fields inside an element', () => {
    const outcome = parseSearchResponse(
      envelope({
        pageInfo: { isLast: false },
        results: [
          {
            __typename: 'Product',
            id: ELDEN,
            name: null,
            media: null,
            price: { basePrice: null, serviceBranding: null },
            platforms: ['PS5'],
            storeDisplayClassification: 'FULL_GAME',
          },
        ],
      }),
    )

    expect(outcome).toMatchObject({ kind: 'ok', isLast: false, dropped: 0 })
  })

  it('drops one odd element without emptying the page', () => {
    const outcome = parseSearchResponse(
      envelope({
        pageInfo: { isLast: true },
        results: [
          { __typename: 'Product', id: 5 },
          'text',
          null,
          { __typename: 'Product', id: ELDEN, platforms: ['PS5'] },
        ],
      }),
    )

    expect(outcome).toMatchObject({ kind: 'ok', dropped: 3 })
    if (outcome.kind === 'ok') expect(outcome.entries).toHaveLength(1)
  })

  it('reads an empty result list as an empty page', () => {
    expect(
      parseSearchResponse(
        envelope({ pageInfo: { isLast: true, totalCount: 0 }, results: [] }),
      ),
    ).toEqual({ kind: 'ok', entries: [], isLast: true, dropped: 0 })
  })

  it.each([
    ['a missing node', { data: {} }],
    ['a null node', envelope(null)],
    ['a non-object body', 'oops'],
    ['missing results', envelope({ pageInfo: { isLast: true } })],
    ['missing pageInfo', envelope({ results: [] })],
    [
      'a non-boolean isLast',
      envelope({ pageInfo: { isLast: 'yes' }, results: [] }),
    ],
    [
      'a results value that is not a list',
      envelope({ pageInfo: { isLast: true }, results: {} }),
    ],
  ])('reports drift for %s', (_label, body) => {
    expect(parseSearchResponse(body)).toEqual({ kind: 'drift' })
  })
})

describe('extractProductDetail platforms', () => {
  it('reads the platform list for the concept check', () => {
    const detail = extractProductDetail({
      data: {
        productRetrieve: {
          storeDisplayClassification: 'FULL_GAME',
          platforms: ['PS4', 'PS5'],
        },
      },
    })

    expect(detail.platforms).toEqual(['PS4', 'PS5'])
  })

  it('degrades to no platforms when the field is absent or null', () => {
    expect(
      extractProductDetail({ data: { productRetrieve: {} } }).platforms,
    ).toEqual([])
    expect(extractProductDetail({}).platforms).toEqual([])
  })
})
