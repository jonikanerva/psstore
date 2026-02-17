import { describe, expect, it } from 'vitest'
import { fetchConceptsByFeature } from '../sony/sonyClient.js'
import { conceptToGame } from '../sony/mapper.js'

const SMOKE = process.env['SMOKE'] === '1'
const describeSmoke = SMOKE ? describe : describe.skip

describeSmoke('Sony API smoke tests (SMOKE=1)', () => {
  it('new: returns non-empty game list', async () => {
    const concepts = await fetchConceptsByFeature('new', 10)
    expect(concepts.length).toBeGreaterThan(0)

    const games = concepts.map(conceptToGame)
    expect(games.length).toBeGreaterThan(0)
    expect(games[0].id).toBeTruthy()
    expect(games[0].name).toBeTruthy()
  }, 15_000)

  it('discounted: returns non-empty game list', async () => {
    const concepts = await fetchConceptsByFeature('discounted', 10)
    expect(concepts.length).toBeGreaterThan(0)

    const games = concepts.map(conceptToGame)
    expect(games[0].id).toBeTruthy()
  }, 15_000)

  it('upcoming: returns concepts', async () => {
    const concepts = await fetchConceptsByFeature('upcoming', 10)
    // Upcoming may legitimately be empty if no games launch in 30 days
    expect(Array.isArray(concepts)).toBe(true)
  }, 15_000)

  it('plus: returns non-empty game list', async () => {
    const concepts = await fetchConceptsByFeature('plus', 10)
    expect(concepts.length).toBeGreaterThan(0)
  }, 15_000)
})
