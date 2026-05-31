import { Either, Schema } from 'effect'

/**
 * Sony's GraphQL endpoint answers HTTP 200 even when a persisted query hash no
 * longer matches its current store build: the failure is reported Apollo-style
 * as a top-level `errors[]` array carrying `PERSISTED_QUERY_NOT_FOUND`. This is
 * invisible to `response.ok` (STACK boundary: external data is untrusted until
 * decoded), so both the list and product paths must inspect the decoded body.
 *
 * Defensive boundary envelope: every field optional, unknown keys preserved.
 */
const graphqlErrorSchema = Schema.Struct({
  message: Schema.optional(Schema.String),
  extensions: Schema.optional(
    Schema.Struct({
      code: Schema.optional(Schema.String),
    }),
  ),
})

const graphqlErrorEnvelopeSchema = Schema.Struct({
  errors: Schema.optional(Schema.Array(graphqlErrorSchema)),
})

const decodeEnvelope = Schema.decodeUnknownEither(graphqlErrorEnvelopeSchema, {
  onExcessProperty: 'preserve',
})

// The canonical Apollo Persisted Query Protocol code.
const PERSISTED_QUERY_NOT_FOUND = 'PERSISTED_QUERY_NOT_FOUND'

/**
 * Detect a persisted-query rotation in a decoded GraphQL response body.
 *
 * Matches the canonical `extensions.code === 'PERSISTED_QUERY_NOT_FOUND'`, and
 * — because Sony's exact casing/wording is not captured in any fixture we hold
 * (uncertainty: no recorded PersistedQueryNotFound sample) — also a
 * case-insensitive substring fallback on the error message/code text. A false
 * positive only routes to a 502 (UpstreamQueryRotated) instead of a generic
 * 502, so the fallback is safe to keep broad.
 *
 * Pure and exported for unit testing.
 */
export const detectPersistedQueryRotation = (json: unknown): boolean => {
  const result = decodeEnvelope(json)
  if (Either.isLeft(result)) {
    return false
  }
  const errors = result.right.errors ?? []
  return errors.some((error) => {
    if (error.extensions?.code === PERSISTED_QUERY_NOT_FOUND) {
      return true
    }
    const haystacks = [error.extensions?.code, error.message]
    return haystacks.some(
      (text) =>
        typeof text === 'string' &&
        text.toLowerCase().includes('persistedquerynotfound'),
    )
  })
}
