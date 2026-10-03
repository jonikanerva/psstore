import { describe, expect, it } from 'vitest'
import { parseConceptProductId } from '../sony/conceptSchema.js'

const SKU = 'EP9000-PPSA01341_00-DEMONSSOULS00000'
const OTHER = 'EP9000-PPSA01341_00-DEMONSSOULSDX000'

const concept = (node: unknown): unknown => ({
  data: { conceptRetrieve: node },
})

describe('parseConceptProductId', () => {
  it('reads the default product id', () => {
    expect(
      parseConceptProductId(
        concept({ defaultProduct: { id: SKU }, products: [{ id: OTHER }] }),
      ),
    ).toBe(SKU)
  })

  it('falls back to the first valid product', () => {
    expect(
      parseConceptProductId(
        concept({
          defaultProduct: null,
          products: [{ id: 'bad' }, { id: OTHER }],
        }),
      ),
    ).toBe(OTHER)
  })

  it('gives null for a concept without a valid product', () => {
    expect(
      parseConceptProductId(
        concept({ defaultProduct: { id: 'x' }, products: [] }),
      ),
    ).toBeNull()
  })

  it('gives null for Sony errors and unknown shapes', () => {
    expect(
      parseConceptProductId({
        data: null,
        errors: [{ message: 'Concept not available for [1, FI, en]' }],
      }),
    ).toBeNull()
    expect(parseConceptProductId(concept(null))).toBeNull()
    expect(parseConceptProductId('nope')).toBeNull()
    expect(parseConceptProductId(null)).toBeNull()
  })
})
