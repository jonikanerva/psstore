import { describe, expect, it } from 'vitest'
import { isValidProductId } from '../utils/productId.js'

describe('isValidProductId', () => {
  it('accepts a product SKU id', () => {
    expect(isValidProductId('EP0001-PPSA00001_00-SYNTHETICALPHA00')).toBe(true)
  })

  it('rejects a concept id and malformed ids', () => {
    expect(isValidProductId('10000001')).toBe(false)
    expect(isValidProductId('')).toBe(false)
    expect(isValidProductId('ep0001-ppsa00001_00-x')).toBe(false)
  })
})
