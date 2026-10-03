import { Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { SONY_AUTH_REDIRECT_URI } from '../config/env.js'
import { mapPurchasedToGames } from '../domain/library.js'
import { dedupePurchased, parsePurchasedPage } from '../sony/purchasedSchema.js'
import { extractAccessCode, parseTokenResponse } from '../sony/sessionSchema.js'
import fixture from './fixtures/purchasedPage.synthetic.json' with { type: 'json' }

const page = (games: readonly unknown[]): unknown => ({
  data: { purchasedTitlesRetrieve: { games } },
})

const game = (overrides: Record<string, unknown> = {}): unknown => ({
  conceptId: '10000001',
  name: 'Synthetic Game',
  platform: 'PS5',
  productId: 'EP0001-PPSA00001_00-SYNTHETICGAME000',
  image: { url: 'https://img.test/game.png' },
  ...overrides,
})

describe('parsePurchasedPage', () => {
  it('keeps only exact PS5 entries from the synthetic fixture', () => {
    const outcome = parsePurchasedPage(fixture)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.rawCount).toBe(5)
    expect(outcome.entries.map((entry) => entry.name)).toEqual([
      'Synthetic Alpha',
      'Synthetic Beta',
    ])
    expect(outcome.entries[1]?.conceptId).toBeNull()
    expect(outcome.outOfScope).toBe(3)
  })

  it('drops PS4, other platforms, odd-case and missing platforms', () => {
    for (const platform of ['PS4', 'PS3', 'ps5', 'Ps5', ' PS5', '', null]) {
      const outcome = parsePurchasedPage(page([game({ platform })]))
      expect(outcome).toMatchObject({ kind: 'ok', entries: [], outOfScope: 1 })
    }
    const missing = parsePurchasedPage(page([game({ platform: undefined })]))
    expect(missing).toMatchObject({ kind: 'ok', entries: [] })
  })

  it('drops an invalid product id as out of scope', () => {
    const outcome = parsePurchasedPage(page([game({ productId: 'bogus' })]))
    expect(outcome).toMatchObject({ kind: 'ok', entries: [], outOfScope: 1 })
  })

  it('counts a malformed element as dropped and keeps its neighbours', () => {
    const outcome = parsePurchasedPage(
      page([42, null, game({ name: '' }), game({ productId: 7 }), game()]),
    )
    expect(outcome).toMatchObject({ kind: 'ok', dropped: 4 })
    if (outcome.kind === 'ok') {
      expect(outcome.entries).toHaveLength(1)
      expect(outcome.rawCount).toBe(5)
    }
  })

  it('reports an unknown envelope as drift', () => {
    for (const body of [
      null,
      {},
      { data: null },
      { data: {} },
      { data: { purchasedTitlesRetrieve: null } },
      { data: { purchasedTitlesRetrieve: { games: 'x' } } },
      { data: { purchasedTitlesRetrieve: {} } },
    ]) {
      expect(parsePurchasedPage(body)).toEqual({ kind: 'drift' })
    }
  })

  it('treats an empty list as a successful empty page', () => {
    expect(parsePurchasedPage(page([]))).toMatchObject({
      kind: 'ok',
      rawCount: 0,
      entries: [],
    })
  })

  it('uses an empty image url when the image is absent', () => {
    const outcome = parsePurchasedPage(page([game({ image: null })]))
    expect(outcome).toMatchObject({ kind: 'ok' })
    if (outcome.kind === 'ok') {
      expect(outcome.entries[0]?.imageUrl).toBe('')
    }
  })
})

describe('dedupePurchased', () => {
  it('keeps the first entry per product id in Sony order', () => {
    const base = { conceptId: null, imageUrl: '' }
    const result = dedupePurchased([
      { ...base, productId: 'A', name: 'first' },
      { ...base, productId: 'B', name: 'second' },
      { ...base, productId: 'A', name: 'duplicate' },
    ])
    expect(result.map((entry) => entry.name)).toEqual(['first', 'second'])
  })
})

describe('mapPurchasedToGames', () => {
  it('links to the concept when Sony gives one, else to the product', () => {
    const outcome = parsePurchasedPage(fixture)
    if (outcome.kind !== 'ok') throw new Error('fixture must decode')
    const games = mapPurchasedToGames(outcome.entries)
    expect(games.map((entry) => [entry.id, entry.idKind])).toEqual([
      ['10000001', 'concept'],
      ['EP0001-PPSA00002_00-SYNTHETICBETA000', 'product'],
    ])
  })

  it('keeps Sony order, no date and no price', () => {
    const games = mapPurchasedToGames([
      { productId: 'B', conceptId: '2', name: 'Bravo', imageUrl: 'u' },
      { productId: 'A', conceptId: '1', name: 'Alpha', imageUrl: 'u' },
    ])
    expect(games.map((entry) => entry.name)).toEqual(['Bravo', 'Alpha'])
    expect(games[0]).toMatchObject({ date: '', price: '', preOrder: false })
  })
})

describe('parseTokenResponse', () => {
  it('reads only the access token and its lifetime', () => {
    const session = parseTokenResponse({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
      id_token: 'synthetic-id',
      expires_in: 3599,
    })
    expect(session).not.toBeNull()
    expect(Object.keys(session ?? {}).sort()).toEqual([
      'accessToken',
      'expiresInSeconds',
    ])
    expect(session?.expiresInSeconds).toBe(3599)
    expect(Redacted.value(session?.accessToken ?? Redacted.make(''))).toBe(
      'synthetic-access',
    )
    expect(JSON.stringify(session)).not.toContain('synthetic-access')
    expect(JSON.stringify(session)).not.toContain('synthetic-refresh')
  })

  it('returns null without a usable access token', () => {
    expect(parseTokenResponse({})).toBeNull()
    expect(parseTokenResponse({ access_token: '' })).toBeNull()
    expect(parseTokenResponse({ access_token: 5 })).toBeNull()
    expect(parseTokenResponse(null)).toBeNull()
  })
})

describe('extractAccessCode', () => {
  it('reads the code from the redirect location', () => {
    expect(
      extractAccessCode(`${SONY_AUTH_REDIRECT_URI}/?code=v3.synthetic&cid=1`),
    ).toBe('v3.synthetic')
  })

  it('returns null when there is no code or the target is foreign', () => {
    expect(extractAccessCode(null)).toBeNull()
    expect(extractAccessCode(`${SONY_AUTH_REDIRECT_URI}/`)).toBeNull()
    expect(extractAccessCode(`${SONY_AUTH_REDIRECT_URI}/?code=`)).toBeNull()
    expect(extractAccessCode(`${SONY_AUTH_REDIRECT_URI}/?error=x`)).toBeNull()
    expect(
      extractAccessCode('https://login.example.test/?code=v3.synthetic'),
    ).toBeNull()
  })
})
