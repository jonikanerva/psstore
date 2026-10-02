import { describe, expect, it } from 'vitest'
import {
  mapConceptsToGames,
  mapUpcomingConceptsToGames,
} from '../domain/listing.js'
import { extractCategoryGrid } from '../sony/sonyClient.js'

// Scope is enforced before anything reaches the UI: an item outside the
// product scope is dropped while the rest of the list survives, and one bad
// item never fails the whole decode.

const goodSku = 'EP0001-PPSA00001_00-ALPHA00000000000'

const grid = (concepts: unknown[]): unknown => ({
  data: { categoryGridRetrieve: { concepts } },
})

const concept = (id: string, name: string): Record<string, unknown> => ({
  id: `c-${name}`,
  name,
  price: { basePrice: '€29,95', discountedPrice: '€29,95' },
  products: [{ id }],
})

describe('scope drop at the Sony boundary', () => {
  it('drops out-of-scope items and keeps the in-scope game', () => {
    const outcome = extractCategoryGrid(
      grid([
        concept(goodSku, 'Alpha'),
        concept('UP0001-PPSA00002_01-ADDON000000000', 'Addon'),
        concept('', 'Idless'),
        { id: { broken: true }, name: 'Broken' },
        null,
      ]),
    )

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.dropped).toBe(2)
    expect(mapConceptsToGames(outcome.concepts).map((g) => g.id)).toEqual([
      goodSku,
    ])
  })

  it('keeps an id-less-SKU announcement only on the UPCOMING path', () => {
    const outcome = extractCategoryGrid(
      grid([concept(goodSku, 'Alpha'), { id: 'c-1', name: 'Announced' }]),
    )

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(mapConceptsToGames(outcome.concepts)).toHaveLength(1)
    const upcoming = mapUpcomingConceptsToGames(outcome.concepts)
    expect(upcoming.map((g) => g.idKind)).toEqual(['product', 'concept'])
  })
})
