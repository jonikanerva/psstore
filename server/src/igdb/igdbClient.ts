import { Cache, Context, Duration, Effect, Layer, Redacted } from 'effect'
import {
  IGDB_CANDIDATE_LIMIT,
  IGDB_GAMES_URL,
  IGDB_TIMEOUT_MS,
  IGDB_TOKEN_EXPIRY_MARGIN_SECONDS,
  IGDB_TOKEN_URL,
} from '../config/env.js'
import type { CriticCandidate } from '../domain/criticMatch.js'
import {
  CriticSourceRejected,
  CriticSourceUnavailable,
} from '../errors/errors.js'
import { fetchWithRetry, HttpStatusError } from '../lib/http.js'
import {
  parseGamesResponse,
  parseTokenResponse,
  type IgdbToken,
} from './igdbSchema.js'

export type IgdbError = CriticSourceRejected | CriticSourceUnavailable

export interface IgdbCredentials {
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted
}

export interface IgdbClientApi {
  // Candidates for a public game title released within one year of `year`.
  // Sends nothing but the title and the year range to the provider.
  readonly findGames: (
    title: string,
    year: number,
  ) => Effect.Effect<readonly CriticCandidate[], IgdbError>
}

export class IgdbClient extends Context.Service<IgdbClient, IgdbClientApi>()(
  'IgdbClient',
) {}

// A failed token exchange is cached this long so an outage is not retried on
// every game page view.
const TOKEN_FAILURE_TTL = Duration.seconds(30)

// The title sits inside a quoted string of the provider's query language.
// Quotes, backslashes, and control characters would end the string early.
export const quoteTitle = (title: string): string =>
  Array.from(title, (char) => {
    const code = char.codePointAt(0) ?? 0
    return char === '"' || char === '\\' || code < 0x20 || code === 0x7f
      ? ' '
      : char
  })
    .join('')
    .trim()

export const buildGamesQuery = (title: string, year: number): string => {
  const from = Math.floor(Date.UTC(year - 1, 0, 1) / 1000)
  const to = Math.floor(Date.UTC(year + 2, 0, 1) / 1000)
  return [
    `search "${quoteTitle(title)}";`,
    'fields name,first_release_date,aggregated_rating,aggregated_rating_count;',
    `where first_release_date >= ${String(from)} & first_release_date < ${String(to)};`,
    `limit ${String(IGDB_CANDIDATE_LIMIT)};`,
  ].join(' ')
}

const classify = (error: unknown): IgdbError =>
  error instanceof HttpStatusError &&
  (error.status === 401 || error.status === 403 || error.status === 400)
    ? new CriticSourceRejected({ message: `status ${String(error.status)}` })
    : new CriticSourceUnavailable({ message: 'provider request failed' })

const requestToken = (
  credentials: IgdbCredentials,
): Effect.Effect<IgdbToken, IgdbError> =>
  Effect.tryPromise({
    try: async () => {
      // The credentials travel in the form body, never in the URL.
      const response = await fetchWithRetry(
        IGDB_TOKEN_URL,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: Redacted.value(credentials.clientSecret),
            grant_type: 'client_credentials',
          }),
        },
        IGDB_TIMEOUT_MS,
        0,
      )
      const body: unknown = await response.json()
      return body
    },
    catch: classify,
  }).pipe(
    Effect.flatMap((body) => {
      const token = parseTokenResponse(body)
      return token === null
        ? Effect.fail(
            new CriticSourceUnavailable({ message: 'unexpected token body' }),
          )
        : Effect.succeed(token)
    }),
  )

const requestGames = (
  credentials: IgdbCredentials,
  token: IgdbToken,
  title: string,
  year: number,
): Effect.Effect<readonly CriticCandidate[], IgdbError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetchWithRetry(
        IGDB_GAMES_URL,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Client-ID': credentials.clientId,
            Authorization: `Bearer ${Redacted.value(token.accessToken)}`,
          },
          body: buildGamesQuery(title, year),
        },
        IGDB_TIMEOUT_MS,
        0,
      )
      const body: unknown = await response.json()
      return body
    },
    catch: classify,
  }).pipe(
    Effect.flatMap((body) => {
      const candidates = parseGamesResponse(body)
      return candidates === null
        ? Effect.fail(
            new CriticSourceUnavailable({ message: 'unexpected games body' }),
          )
        : Effect.succeed(candidates)
    }),
  )

export const IgdbClientLive = (
  credentials: IgdbCredentials,
): Layer.Layer<IgdbClient> =>
  Layer.effect(
    IgdbClient,
    Effect.gen(function* () {
      // One token, held in memory only. Concurrent callers share one exchange.
      // The entry expires before the provider's expiry.
      const tokenCache = yield* Cache.makeWith<'token', IgdbToken, IgdbError>(
        () => requestToken(credentials),
        {
          capacity: 1,
          timeToLive: (exit) =>
            exit._tag === 'Success'
              ? Duration.seconds(
                  Math.max(
                    exit.value.expiresInSeconds -
                      IGDB_TOKEN_EXPIRY_MARGIN_SECONDS,
                    0,
                  ),
                )
              : TOKEN_FAILURE_TTL,
        },
      )

      const attempt = (title: string, year: number) =>
        Cache.get(tokenCache, 'token').pipe(
          Effect.flatMap((token) =>
            requestGames(credentials, token, title, year),
          ),
        )

      // A rejected token is dropped and the call repeats once with a new one.
      const findGames: IgdbClientApi['findGames'] = (title, year) =>
        attempt(title, year).pipe(
          Effect.catchTag('CriticSourceRejected', () =>
            Cache.invalidate(tokenCache, 'token').pipe(
              Effect.andThen(attempt(title, year)),
            ),
          ),
        )

      return IgdbClient.of({ findGames })
    }),
  )
