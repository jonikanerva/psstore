import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { EnvLive } from '../config/env.js'
import { conceptToGame } from '../sony/mapper.js'
import { SonyClient, SonyClientLive } from '../sony/sonyClient.js'

const SMOKE = process.env['SMOKE'] === '1'
const describeSmoke = SMOKE ? describe : describe.skip

const LiveClient = SonyClientLive.pipe(Layer.provide(EnvLive))

const fetchConcepts = (feature: 'new' | 'upcoming' | 'discounted', size: number) =>
  SonyClient.pipe(
    Effect.flatMap((client) => client.fetchConceptsByFeature(feature, size)),
    Effect.provide(LiveClient),
    Effect.runPromise,
  )

describeSmoke('Sony API smoke tests (SMOKE=1)', () => {
  it('new: returns non-empty game list', async () => {
    const concepts = await fetchConcepts('new', 10)
    expect(concepts.length).toBeGreaterThan(0)

    const games = concepts.map(conceptToGame)
    expect(games.length).toBeGreaterThan(0)
    const first = games[0]
    expect(first).toBeDefined()
    expect(first?.id).toBeTruthy()
    expect(first?.name).toBeTruthy()
  }, 15_000)

  it('discounted: returns non-empty game list', async () => {
    const concepts = await fetchConcepts('discounted', 10)
    expect(concepts.length).toBeGreaterThan(0)

    const games = concepts.map(conceptToGame)
    const first = games[0]
    expect(first).toBeDefined()
    expect(first?.id).toBeTruthy()
  }, 15_000)

  it('upcoming: returns concepts', async () => {
    const concepts = await fetchConcepts('upcoming', 10)
    expect(Array.isArray(concepts)).toBe(true)
  }, 15_000)
})
