import { describe, expect, it } from 'vitest'
import {
  CAPTURE_HEADER_ALLOWLIST,
  redactHeaders,
} from '../contract/constants.js'

describe('redactHeaders', () => {
  it('drops sensitive headers (token / cookie / session / auth)', () => {
    const redacted = redactHeaders({
      authorization: 'Bearer secret',
      cookie: 'sid=abc',
      'set-cookie': 'sid=abc; HttpOnly',
      'x-session-token': 'sess-123',
      'x-auth-token': 'auth-123',
    })

    expect(redacted).toEqual({})
  })

  it('keeps all seven safe headers', () => {
    const safe: Record<string, string> = {
      'x-apollo-operation-name': 'categoryGridRetrieve',
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-language': 'fi-FI',
      origin: 'https://store.playstation.com',
      referer: 'https://store.playstation.com/fi-fi',
      'x-psn-store-locale': 'fi-fi',
    }

    expect(redactHeaders(safe)).toEqual(safe)
    // Guard: the allowlist is exactly these seven keys.
    expect([...CAPTURE_HEADER_ALLOWLIST].sort()).toEqual(
      Object.keys(safe).sort(),
    )
  })

  it('drops a header that is neither sensitive nor allowlisted', () => {
    const redacted = redactHeaders({
      'x-frame-options': 'DENY',
      accept: 'application/json',
    })

    expect(redacted).toEqual({ accept: 'application/json' })
  })

  it('handles mixed-case keys identically (case-insensitive)', () => {
    const redacted = redactHeaders({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'X-Apollo-Operation-Name': 'categoryGridRetrieve',
    })

    // Authorization dropped (sensitive); the allowlisted keys are kept with
    // their original casing preserved.
    expect(redacted).toEqual({
      'Content-Type': 'application/json',
      'X-Apollo-Operation-Name': 'categoryGridRetrieve',
    })
  })

  it('returns a new object and does not mutate the input', () => {
    const input = { authorization: 'secret', accept: 'application/json' }
    const redacted = redactHeaders(input)

    expect(redacted).not.toBe(input)
    expect(input).toEqual({
      authorization: 'secret',
      accept: 'application/json',
    })
  })
})
