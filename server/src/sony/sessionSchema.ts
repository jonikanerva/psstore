import { Redacted, Result, Schema } from 'effect'
import { SONY_AUTH_REDIRECT_URI } from '../config/env.js'

// Only the access token and its lifetime are decoded. Sony also returns a
// refresh token and an id token; they are never read, so they cannot be kept.
const tokenResponseSchema = Schema.Struct({
  access_token: Schema.RedactedFromValue(
    Schema.String.check(Schema.isMinLength(1)),
  ),
  expires_in: Schema.optional(Schema.Number),
})

const decodeTokenResponse = Schema.decodeUnknownResult(tokenResponseSchema)

export interface SonySession {
  readonly accessToken: Redacted.Redacted
  readonly expiresInSeconds: number | null
}

/** Decode the token endpoint body. `null` when it has no usable access token. */
export const parseTokenResponse = (json: unknown): SonySession | null => {
  const decoded = decodeTokenResponse(json)
  if (Result.isFailure(decoded)) {
    return null
  }
  return {
    accessToken: decoded.success.access_token,
    expiresInSeconds: decoded.success.expires_in ?? null,
  }
}

/**
 * Read the access code from the `Location` header of the authorize redirect.
 * The header carries a one-time code: callers must never log or return it.
 * `null` when the header is absent, points elsewhere, or has no code.
 */
export const extractAccessCode = (location: string | null): string | null => {
  if (location === null || !location.startsWith(SONY_AUTH_REDIRECT_URI)) {
    return null
  }
  const queryStart = location.indexOf('?')
  if (queryStart === -1) {
    return null
  }
  const code = new URLSearchParams(location.slice(queryStart + 1)).get('code')
  return code === null || code === '' ? null : code
}
