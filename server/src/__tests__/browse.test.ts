import { readFileSync } from 'node:fs'
import { BROWSE_ORDERS } from '@psstore/shared'
import { describe, expect, it } from 'vitest'
import {
  BROWSE_MAX_CANDIDATES,
  browseCandidateIds,
  browseConceptToGame,
  narrowGenres,
} from '../domain/listing.js'
import {
  BROWSE_SONY_SORT,
  buildBrowseVariables,
  buildGenreListVariables,
} from '../sony/queryStrategies.js'
import { extractBrowsePage, extractGenres } from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

const golden = JSON.parse(
  readFileSync(
    new URL('./fixtures/categoryGridBrowse.golden.json', import.meta.url),
    'utf8',
  ),
) as unknown

const grid = (node: Record<string, unknown>): unknown => ({
  data: { categoryGridRetrieve: node },
})

const concept = (ids: readonly string[]): Concept => ({
  id: '1000',
  name: 'Concept',
  products: ids.map((id) => ({ id })),
})

const PS4_A = 'EP0006-CUSA12552_00-APEXLEGENDRSPWN1'
const PS5_A = 'EP0006-PPSA04874_00-APEXLEGENDRSPWN1'
const PS5_B = 'EP0006-PPSA04874_00-APEXLEGENDDELUX'

describe('browseCandidateIds', () => {
  it('puts PS5 title ids first and keeps Sony order inside each group', () => {
    expect(browseCandidateIds(concept([PS4_A, PS5_A, PS5_B]))).toEqual([
      PS5_A,
      PS5_B,
      PS4_A,
    ])
  })

  it('caps the candidates and drops invalid and repeated ids', () => {
    const many = Array.from(
      { length: 6 },
      (_, i) => `EP0001-PPSA0000${String(i)}_00-GAME000000000000`,
    )
    const ids = browseCandidateIds(
      concept(['10020880', many[0] ?? '', ...many]),
    )
    expect(ids).toHaveLength(BROWSE_MAX_CANDIDATES)
    expect(ids).toEqual(many.slice(0, BROWSE_MAX_CANDIDATES))
  })

  it('returns no candidate for a concept without a product id', () => {
    expect(browseCandidateIds({ id: '10019955', products: [] })).toEqual([])
    expect(browseCandidateIds({ id: '10019955' })).toEqual([])
  })
})

describe('narrowGenres', () => {
  it('sorts by name, keeps `/` keys, and drops bad and repeated keys', () => {
    expect(
      narrowGenres([
        { key: 'SHOOTER', name: 'Shooter' },
        { key: 'MUSIC/RHYTHM', name: 'Music/Rhythm' },
        { key: 'ACTION', name: 'Action' },
        { key: 'ACTION', name: 'Action again' },
        { key: 'bad key', name: 'Bad' },
        { key: 'x'.repeat(65).toUpperCase(), name: 'Too long' },
      ]),
    ).toEqual([
      { key: 'ACTION', name: 'Action' },
      { key: 'MUSIC/RHYTHM', name: 'Music/Rhythm' },
      { key: 'SHOOTER', name: 'Shooter' },
    ])
  })
})

describe('browseConceptToGame', () => {
  const base: Concept = {
    id: '232352',
    name: 'Apex Legends™',
    price: {
      basePrice: '€19,99',
      discountedPrice: '€9,99',
      discountText: '-50%',
    },
    products: [{ id: PS4_A }, { id: PS5_A }],
  }
  const nowMs = Date.parse('2026-10-06T12:00:00Z')

  it('uses the chosen product id, its date and genres, and the concept name', () => {
    const game = browseConceptToGame(
      base,
      PS5_A,
      { releaseDate: '2026-11-01T00:00:00+02:00', genres: ['Shooter'] },
      nowMs,
    )
    expect(game.id).toBe(PS5_A)
    expect(game.name).toBe('Apex Legends™')
    expect(game.date).toBe('2026-10-31T22:00:00.000Z')
    expect(game.discountDate).toBe('2026-10-31T22:00:00.000Z')
    expect(game.genres).toEqual(['Shooter'])
    expect(game.preOrder).toBe(true)
    expect(game.idKind).toBe('product')
  })

  it('reads the pre-order flag from the given instant', () => {
    const game = browseConceptToGame(
      base,
      PS5_A,
      { releaseDate: '2026-10-01T00:00:00Z', genres: [] },
      nowMs,
    )
    expect(game.preOrder).toBe(false)
  })

  it('keeps an unparseable date empty and never guesses one', () => {
    const game = browseConceptToGame(
      base,
      PS5_A,
      { releaseDate: 'soon', genres: [] },
      nowMs,
    )
    expect(game.date).toBe('')
    expect(game.preOrder).toBe(false)
  })
})

describe('buildBrowseVariables', () => {
  it.each(BROWSE_ORDERS)('maps %s to a Sony sort', (order) => {
    const variables = buildBrowseVariables({
      genre: 'ROLE_PLAYING_GAMES',
      order,
      offset: 60,
      size: 60,
    })
    expect(variables['sortBy']).toEqual(BROWSE_SONY_SORT[order])
    expect(variables['filterBy']).toEqual([
      'targetPlatforms:PS5',
      'conceptGenres:ROLE_PLAYING_GAMES',
    ])
    expect(variables['pageArgs']).toEqual({ size: 60, offset: 60 })
  })

  it('asks for the facets without concepts for the genre list', () => {
    expect(buildGenreListVariables()['pageArgs']).toEqual({
      size: 0,
      offset: 0,
    })
  })
})

describe('extractBrowsePage', () => {
  it('decodes the golden capture with its page info', () => {
    const outcome = extractBrowsePage(golden, 12)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.dropped).toBe(0)
    expect(outcome.page.isLast).toBe(false)
    expect(outcome.page.concepts.map((item) => item.name)).toEqual([
      "Tom Clancy's Rainbow Six Siege",
      'Apex Legends™',
      'Call of Duty®',
    ])
  })

  it('derives the end of the list from a short page without page info', () => {
    const outcome = extractBrowsePage(
      grid({ concepts: [concept([PS5_A])] }),
      60,
    )
    expect(outcome.kind === 'ok' && outcome.page.isLast).toBe(true)
    const full = extractBrowsePage(
      grid({ concepts: [concept([PS5_A])], pageInfo: null }),
      1,
    )
    expect(full.kind === 'ok' && full.page.isLast).toBe(false)
  })

  it('keeps the valid concepts when one element is broken', () => {
    const outcome = extractBrowsePage(
      grid({
        concepts: [concept([PS5_A]), { id: 42 }],
        pageInfo: { isLast: true },
      }),
      60,
    )
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.page.concepts).toHaveLength(1)
    expect(outcome.dropped).toBe(1)
  })

  it('reads a missing grid node as drift, not as an empty page', () => {
    expect(extractBrowsePage({ data: {} }, 60).kind).toBe('drift')
    expect(
      extractBrowsePage({ data: { categoryGridRetrieve: null } }, 60).kind,
    ).toBe('drift')
    expect(extractBrowsePage(grid({ concepts: 'x' }), 60).kind).toBe('drift')
  })
})

describe('extractGenres', () => {
  it('decodes all 35 genres of the golden capture in name order', () => {
    const outcome = extractGenres(golden)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.dropped).toBe(0)
    expect(outcome.genres).toHaveLength(35)
    expect(outcome.genres[0]).toEqual({ key: 'ACTION', name: 'Action' })
    expect(outcome.genres).toContainEqual({
      key: 'FIRST_PERSON_SHOOTER',
      name: 'First Person Shooter',
    })
    expect(outcome.genres).toContainEqual({
      key: 'MUSIC/RHYTHM',
      name: 'Music/Rhythm',
    })
    const names = outcome.genres.map((genre) => genre.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('drops one invalid value among valid values and counts it', () => {
    const outcome = extractGenres(
      grid({
        facetOptions: [
          {
            name: 'conceptGenres',
            values: [
              { key: 'ACTION', displayName: 'Action' },
              { key: null, displayName: 'No key' },
              { key: 'bad key', displayName: 'Bad' },
              7,
            ],
          },
        ],
      }),
    )
    expect(outcome).toEqual({
      kind: 'ok',
      genres: [{ key: 'ACTION', name: 'Action' }],
      dropped: 3,
    })
  })

  it('reads a missing or empty genre facet as drift', () => {
    expect(extractGenres(grid({ facetOptions: [] })).kind).toBe('drift')
    expect(extractGenres(grid({})).kind).toBe('drift')
    expect(
      extractGenres(
        grid({ facetOptions: [{ name: 'conceptGenres', values: null }] }),
      ).kind,
    ).toBe('drift')
    expect(
      extractGenres(
        grid({
          facetOptions: [
            { name: 'conceptGenres', values: [{ key: 'bad key' }] },
          ],
        }),
      ).kind,
    ).toBe('drift')
  })
})
