import { describe, expect, it } from 'vitest'
import {
  extractProductDetail,
  extractReleaseDateFromProductResponse,
} from '../sony/sonyClient.js'
import { buildStrategies } from '../sony/queryStrategies.js'
import type { AppConfig } from '../config/env.js'

const config: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  SONY_GRAPHQL_URL: 'https://web.np.playstation.com/api/graphql/v1/op',
  SONY_CATEGORY_GRID_HASH: 'hash',
  SONY_CATEGORY_ID: 'category',
  SONY_DEALS_CATEGORY_ID: 'deals',
  SONY_OPERATION_NAME: 'categoryGridRetrieve',
  SONY_PRODUCT_OPERATION_NAME: 'metGetProductById',
  SONY_PRODUCT_BY_ID_HASH: 'producthash',
  SONY_LOCALE: 'fi-fi',
  SONY_RETRY_COUNT: 1,
  SONY_TIMEOUT_MS: 6000,
  CACHE_TTL_MS: 30000,
}

describe('buildStrategies.new', () => {
  it('filters NEW to PS5 and Sony\'s released "last_thirty_days" facet', () => {
    const variables = buildStrategies(config).new.buildVariables({})
    expect(variables.filterBy).toEqual([
      'targetPlatforms:PS5',
      'conceptReleaseDate:last_thirty_days',
    ])
  })

  it('keeps NEW sorted conceptReleaseDate descending', () => {
    const variables = buildStrategies(config).new.buildVariables({})
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
