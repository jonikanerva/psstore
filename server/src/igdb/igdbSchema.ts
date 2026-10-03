import { Redacted, Result, Schema } from 'effect'
import type { CriticCandidate } from '../domain/criticMatch.js'

// The token response: only the access token and its lifetime are read.
const tokenResponseSchema = Schema.Struct({
  access_token: Schema.RedactedFromValue(
    Schema.String.check(Schema.isMinLength(1)),
  ),
  expires_in: Schema.Number,
})

const decodeTokenResponse = Schema.decodeUnknownResult(tokenResponseSchema)

export interface IgdbToken {
  readonly accessToken: Redacted.Redacted
  readonly expiresInSeconds: number
}

/** Decode the token endpoint body. `null` without a usable token and lifetime. */
export const parseTokenResponse = (json: unknown): IgdbToken | null => {
  const decoded = decodeTokenResponse(json)
  if (Result.isFailure(decoded) || !(decoded.success.expires_in > 0)) {
    return null
  }
  return {
    accessToken: decoded.success.access_token,
    expiresInSeconds: decoded.success.expires_in,
  }
}

// Only the name is required. Every other field is read as unknown and narrowed
// below, so one malformed value drops that value, not the whole candidate.
const gameSchema = Schema.Struct({
  name: Schema.String,
  first_release_date: Schema.optionalKey(Schema.Unknown),
  aggregated_rating: Schema.optionalKey(Schema.Unknown),
  aggregated_rating_count: Schema.optionalKey(Schema.Unknown),
})

const decodeGame = Schema.decodeUnknownResult(gameSchema)

const yearOfUnixSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).getUTCFullYear()
    : null

const ratingOf = (value: unknown): number | null =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100
    ? Math.round(value)
    : null

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0

/**
 * Decode the games response. `null` when the body is not an array (drift).
 * An element without a string name is dropped.
 */
export const parseGamesResponse = (
  json: unknown,
): readonly CriticCandidate[] | null => {
  if (!Array.isArray(json)) {
    return null
  }
  const items: readonly unknown[] = json
  return items.flatMap((item) => {
    const decoded = decodeGame(item)
    if (Result.isFailure(decoded)) {
      return []
    }
    const game = decoded.success
    return [
      {
        name: game.name,
        releaseYear: yearOfUnixSeconds(game.first_release_date),
        rating: ratingOf(game.aggregated_rating),
        ratingCount: countOf(game.aggregated_rating_count),
      },
    ]
  })
}
