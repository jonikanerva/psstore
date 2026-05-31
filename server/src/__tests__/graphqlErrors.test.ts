import { describe, expect, it } from 'vitest'
import { detectPersistedQueryRotation } from '../sony/graphqlErrors.js'

describe('detectPersistedQueryRotation', () => {
  it('matches the canonical Apollo extensions.code', () => {
    const body = {
      errors: [
        {
          message: 'PersistedQueryNotFound',
          extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' },
        },
      ],
    }
    expect(detectPersistedQueryRotation(body)).toBe(true)
  })

  it('matches via the case-insensitive message substring fallback', () => {
    // No canonical code present — only the message names the condition (Sony's
    // exact wording is not captured in any held fixture).
    const body = {
      errors: [{ message: 'persistedquerynotfound: unknown hash' }],
    }
    expect(detectPersistedQueryRotation(body)).toBe(true)
  })

  it('matches the substring fallback regardless of casing in the code', () => {
    const body = {
      errors: [{ extensions: { code: 'PersistedQueryNotFound' } }],
    }
    expect(detectPersistedQueryRotation(body)).toBe(true)
  })

  it('does not match an unrelated GraphQL error', () => {
    const body = {
      errors: [
        {
          message: 'Some other failure',
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        },
      ],
    }
    expect(detectPersistedQueryRotation(body)).toBe(false)
  })

  it('returns false for a normal data response with no errors array', () => {
    expect(
      detectPersistedQueryRotation({ data: { categoryGridRetrieve: {} } }),
    ).toBe(false)
    expect(detectPersistedQueryRotation({})).toBe(false)
  })

  it('returns false for a non-object body without throwing', () => {
    expect(detectPersistedQueryRotation(null)).toBe(false)
    expect(detectPersistedQueryRotation('nope')).toBe(false)
    expect(detectPersistedQueryRotation(42)).toBe(false)
  })
})
