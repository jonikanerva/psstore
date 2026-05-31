import { describe, expect, it } from 'vitest'
import {
  mapConceptsToGames,
  mapUpcomingConceptsToGames,
} from '../domain/listing.js'
import { parseProductRetrieve } from '../sony/productDetailSchema.js'
import {
  extractCategoryGrid,
  extractProductDetail,
  type ProductDetailResult,
} from '../sony/sonyClient.js'
import brokenGolden from './fixtures/categoryGridBrokenElement.golden.json' with { type: 'json' }
import conceptsGolden from './fixtures/categoryGridConcepts.golden.json' with { type: 'json' }
import productsGolden from './fixtures/categoryGridProducts.golden.json' with { type: 'json' }
import productGolden from './fixtures/productDetail.golden.json' with { type: 'json' }

// REGRESSION GUARD for the #62 null-tolerance bug (shipped in PASS-reviewed PR
// #79, caught in production, not by tests). These fixtures are TRIMMED REAL Sony
// captures (fi-fi, 2026-05-31; see fixtures/README.md) that PRESERVE every live
// `null` — `concept.price: null`, `price.serviceBranding: null`, etc. Reverting
// the boundary to the pre-#79 `Schema.optional(X)` (no NullOr) or to a
// whole-array decode makes these FAIL. Do not "tighten" the schema without
// re-confirming against live data via `pnpm test:live`.

describe('golden decode — categoryGrid concepts envelope (real fi-fi capture)', () => {
  it('decodes with no dropped elements and maps to >= 1 renderable game', () => {
    const outcome = extractCategoryGrid(conceptsGolden)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.dropped).toBe(0)
      // NEW released SKUs survive the production scope gate (isValidProductId);
      // the bare UPCOMING concepts (price: null) are correctly filtered here.
      expect(
        mapConceptsToGames(outcome.concepts).length,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps a bare UPCOMING concept (price: null) as an idKind:concept card', () => {
    const outcome = extractCategoryGrid(conceptsGolden)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      const games = mapUpcomingConceptsToGames(outcome.concepts)
      const conceptCard = games.find((game) => game.idKind === 'concept')
      // A price:null announced game must survive decode AND map to a concept
      // card (the exact UPCOMING shape #62 emptied).
      expect(conceptCard).toBeDefined()
      expect(conceptCard?.price).toBe('')
    }
  })
})

describe('golden decode — categoryGrid products envelope (DISCOUNTED, real capture)', () => {
  it('exercises the products → productToConcept branch and maps discounted PS Plus pricing', () => {
    const outcome = extractCategoryGrid(productsGolden)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.dropped).toBe(0)
      const games = mapConceptsToGames(outcome.concepts)
      expect(games.length).toBeGreaterThanOrEqual(1)
      // Proves a product carrying price.serviceBranding: null still decodes, and
      // a PS_PLUS-discounted SKU maps with both an original price and the
      // verbatim PS Plus upsell string.
      const discounted = games.find(
        (game) => game.originalPrice !== '' && game.plusUpsellText !== null,
      )
      expect(discounted).toBeDefined()
      expect(discounted?.originalPrice).not.toBe('')
      expect(discounted?.plusUpsellText).not.toBeNull()
    }
  })
})

describe('golden decode — per-element tolerance (the actual #62 fix)', () => {
  it('keeps good elements and drops only the synthetic broken one', () => {
    const good = extractCategoryGrid(conceptsGolden)
    const broken = extractCategoryGrid(brokenGolden)

    expect(broken.kind).toBe('ok')
    if (broken.kind === 'ok' && good.kind === 'ok') {
      // One synthetic broken element was added to the concepts fixture; exactly
      // it is dropped, the rest survive (the whole list is NOT emptied).
      expect(broken.dropped).toBeGreaterThanOrEqual(1)
      expect(broken.concepts.length).toBe(good.concepts.length)
    }
  })
})

describe('golden decode — productRetrieve (metGetProductById, real capture)', () => {
  it('parses the node defensively despite a real null field', () => {
    const node = parseProductRetrieve(productGolden.data.productRetrieve)
    expect(node).not.toBeNull()
  })

  it('extracts the LONG description (not LEGAL/COMPATIBILITY) and >= 1 genre', () => {
    const detail: ProductDetailResult = extractProductDetail(productGolden)
    expect(detail.description.length).toBeGreaterThan(0)
    expect(detail.genres.length).toBeGreaterThanOrEqual(1)
    // The LONG body is real marketing copy; LEGAL/COMPATIBILITY entries are
    // never user-facing and must not be selected.
    expect(detail.description).not.toContain('All rights reserved')
  })
})
