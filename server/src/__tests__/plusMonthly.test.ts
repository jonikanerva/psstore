import { describe, expect, it } from 'vitest'
import { mapMonthlyToGames } from '../domain/listing.js'
import { parsePlusMonthly } from '../sony/plusMonthlySchema.js'
import golden from './fixtures/plusMonthly.golden.json' with { type: 'json' }

const entry = (overrides: Record<string, unknown> = {}) => ({
  productId: 'EP0001-PPSA00001_00-ALPHA00000000000',
  name: 'Alpha',
  imageUrl: 'https://img/alpha',
  releaseDate: '2025-01-01T00:00:00Z',
  genre: ['Action'],
  device: ['PS5'],
  ...overrides,
})

const bucket = (...games: unknown[]) => ({
  catalogKey: 'A',
  count: games.length,
  games,
})

const ok = (json: unknown) => {
  const outcome = parsePlusMonthly(json)
  if (outcome.kind !== 'ok') throw new Error('expected ok')
  return outcome
}

describe('parsePlusMonthly on the real capture', () => {
  it('keeps the four PS5 games and drops the PS4-only and empty-device entries', () => {
    const outcome = ok(golden)
    expect(outcome.entries.map((item) => item.name).sort()).toEqual([
      'Fallout 76 PS4 & PS5',
      'MLB® The Show™ 26',
      'Sniper Elite: Resistance PS4™ & PS5™',
      'Wobbly Life',
    ])
    expect(outcome.outOfScope).toBe(2)
    expect(outcome.dropped).toBe(0)
  })

  it('maps to cards ordered by release date, newest first, without prices', () => {
    const games = mapMonthlyToGames(ok(golden).entries)
    expect(games.map((game) => game.id)).toEqual([
      'EP1003-PPSA30933_00-PROJECTSYMES0000',
      'UP9000-PPSA30630_00-MLBTHESHOW26PLUS',
      'UP7742-PPSA29413_00-0632159817352246',
      'UP4363-PPSA17232_00-SNIPERELITERES00',
    ])
    for (const game of games) {
      expect(game).toMatchObject({
        price: '',
        originalPrice: '',
        plusOffer: null,
        plusUpsellText: null,
        preOrder: false,
        idKind: 'product',
      })
      expect(game.date).toMatch(/Z$/)
    }
  })
})

describe('parsePlusMonthly on synthetic input', () => {
  it('flattens several buckets in order', () => {
    const outcome = ok([
      bucket(entry({ productId: 'EP0001-PPSA00001_00-AAAAAAAAAAAAAAAA' })),
      bucket(entry({ productId: 'EP0001-PPSA00002_00-BBBBBBBBBBBBBBBB' })),
    ])
    expect(outcome.entries).toHaveLength(2)
  })

  it('dedupes by productId, first wins, and keeps a shared concept with another product', () => {
    const first = entry({ name: 'First', conceptId: '1' })
    const second = entry({ name: 'Second', conceptId: '1' })
    const other = entry({
      name: 'Other',
      conceptId: '1',
      productId: 'EP0001-PPSA00009_00-OTHER00000000000',
    })
    const outcome = ok([bucket(first, second), bucket(other)])
    expect(outcome.entries.map((item) => item.name)).toEqual(['First', 'Other'])
  })

  it('drops a PS4 CUSA entry, PS4-only and empty-device entries as out of scope', () => {
    const outcome = ok([
      bucket(
        entry({ device: ['PS4'] }),
        entry({ device: [] }),
        entry({ device: null }),
        entry({
          productId: 'EP0900-CUSA29547_00-4103461541053748',
          device: ['PS4'],
        }),
      ),
    ])
    expect(outcome.entries).toHaveLength(0)
    expect(outcome.outOfScope).toBe(4)
  })

  it('drops a PS5 entry whose id is not a product SKU', () => {
    const outcome = ok([bucket(entry({ productId: '10004896' }))])
    expect(outcome.entries).toHaveLength(0)
    expect(outcome.outOfScope).toBe(1)
  })

  it('drops null and wrong-typed elements without failing the rest', () => {
    const outcome = ok([
      bucket(
        null,
        'text',
        entry({ productId: 5 }),
        entry({ name: null }),
        entry({ productId: null }),
        entry({ releaseDate: 3 }),
        entry({ productId: 'EP0001-PPSA00003_00-GOODGOODGOODGOOD' }),
      ),
      null,
    ])
    expect(outcome.entries.map((item) => item.productId)).toEqual([
      'EP0001-PPSA00003_00-GOODGOODGOODGOOD',
    ])
    expect(outcome.dropped).toBe(7)
  })

  it('keeps an entry with null optional fields', () => {
    const outcome = ok([
      bucket(entry({ imageUrl: null, releaseDate: null, genre: null })),
    ])
    expect(outcome.entries[0]).toMatchObject({
      imageUrl: '',
      releaseDate: '',
      genres: [],
    })
    expect(mapMonthlyToGames(outcome.entries)[0]?.date).toBe('')
  })

  it('treats an empty list or empty buckets as a successful empty result', () => {
    expect(ok([]).entries).toEqual([])
    expect(
      ok([bucket(), { catalogKey: 'B', count: 0, games: null }]).entries,
    ).toEqual([])
  })

  it('reports drift for a body that is not a list of bucket objects', () => {
    for (const body of [
      null,
      undefined,
      {},
      'x',
      5,
      { games: [] },
      ['a', 1, null],
    ]) {
      expect(parsePlusMonthly(body)).toEqual({ kind: 'drift' })
    }
  })
})
