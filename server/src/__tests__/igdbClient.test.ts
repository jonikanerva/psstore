import { Effect, Exit, Logger, Redacted } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildGamesQuery,
  IgdbClient,
  IgdbClientLive,
  quoteTitle,
} from '../igdb/igdbClient.js'

const realFetch = globalThis.fetch
const SECRET = 'synthetic-client-secret'
const credentials = {
  clientId: 'synthetic-client-id',
  clientSecret: Redacted.make(SECRET),
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface Call {
  readonly url: string
  readonly init: RequestInit
}

const stubFetch = (
  respond: (call: Call, index: number) => Response,
): Call[] => {
  const calls: Call[] = []
  globalThis.fetch = vi.fn<typeof fetch>((input, init) => {
    const call = {
      url: input instanceof Request ? input.url : input.toString(),
      init: init ?? {},
    }
    calls.push(call)
    return Promise.resolve(respond(call, calls.length - 1))
  })
  return calls
}

const find = (title = 'Synthetic Quest', year = 2023) =>
  IgdbClient.pipe(Effect.flatMap((client) => client.findGames(title, year)))

const run = <A, E>(
  effect: Effect.Effect<A, E, IgdbClient>,
  logs: string[] = [],
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(IgdbClientLive(credentials)),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logs.push(JSON.stringify([options.message, String(options.cause)]))
          }),
        ]),
      ),
    ),
  )

const tokenBody = (token: string) => ({
  access_token: token,
  expires_in: 5_000_000,
  token_type: 'bearer',
})
const gamesBody = [
  {
    name: 'Synthetic Quest',
    first_release_date: 1700000000,
    aggregated_rating: 84.4,
    aggregated_rating_count: 12,
  },
]

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('IgdbClientLive', () => {
  it('sends the credentials in the token form body, not the URL', async () => {
    const calls = stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok-1'))
        : json(gamesBody),
    )
    const exit = await run(find())
    expect(Exit.isSuccess(exit)).toBe(true)

    const tokenCall = calls[0]
    expect(tokenCall?.url).toBe('https://id.twitch.tv/oauth2/token')
    expect(tokenCall?.url).not.toContain(SECRET)
    expect(tokenCall?.init.method).toBe('POST')
    const form = tokenCall?.init.body
    expect(form).toBeInstanceOf(URLSearchParams)
    if (!(form instanceof URLSearchParams)) return
    expect(form.get('client_id')).toBe('synthetic-client-id')
    expect(form.get('client_secret')).toBe(SECRET)
    expect(form.get('grant_type')).toBe('client_credentials')
  })

  it('sends the token and client id as headers and only the title and year range in the query', async () => {
    const calls = stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok-1'))
        : json(gamesBody),
    )
    await run(find('Synthetic Quest', 2023))
    const gamesCall = calls[1]
    expect(gamesCall?.url).toBe('https://api.igdb.com/v4/games')
    expect(gamesCall?.init.headers).toEqual({
      Accept: 'application/json',
      'Client-ID': 'synthetic-client-id',
      Authorization: 'Bearer tok-1',
    })
    expect(gamesCall?.init.body).toBe(buildGamesQuery('Synthetic Quest', 2023))
  })

  it('reuses one token for concurrent and later calls', async () => {
    const calls = stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok-1'))
        : json(gamesBody),
    )
    await run(
      Effect.all([find(), find('Other'), find('Third')], {
        concurrency: 'unbounded',
      }),
    )
    expect(
      calls.filter((call) => call.url.includes('id.twitch.tv')),
    ).toHaveLength(1)
  })

  it('refreshes the token once after a 401 and retries the call', async () => {
    let token = 0
    const calls = stubFetch((call) => {
      if (call.url.includes('id.twitch.tv')) {
        token += 1
        return json(tokenBody(`tok-${String(token)}`))
      }
      return String(
        call.init.headers &&
          (call.init.headers as Record<string, string>)['Authorization'],
      ) === 'Bearer tok-1'
        ? json({ message: 'Unauthorized' }, 401)
        : json(gamesBody)
    })
    const exit = await run(find())
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(calls.map((call) => call.url.includes('id.twitch.tv'))).toEqual([
      true,
      false,
      true,
      false,
    ])
  })

  it('fails as rejected when the provider keeps answering 401', async () => {
    stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok'))
        : json({}, 401),
    )
    const exit = await run(find())
    expect(JSON.stringify(exit)).toContain('CriticSourceRejected')
  })

  it('fails as unavailable on a 500, a bad body, or a bad token body', async () => {
    stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok'))
        : json({}, 500),
    )
    expect(JSON.stringify(await run(find()))).toContain(
      'CriticSourceUnavailable',
    )

    stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok'))
        : json({ not: 'an array' }),
    )
    expect(JSON.stringify(await run(find()))).toContain(
      'CriticSourceUnavailable',
    )

    stubFetch(() => json({ nothing: true }))
    expect(JSON.stringify(await run(find()))).toContain(
      'CriticSourceUnavailable',
    )
  })

  it('never logs the secret or the token', async () => {
    const logs: string[] = []
    stubFetch((call) =>
      call.url.includes('id.twitch.tv')
        ? json(tokenBody('tok-secret-value'))
        : json({}, 500),
    )
    await run(find(), logs)
    const everything = logs.join('\n')
    expect(everything).not.toContain(SECRET)
    expect(everything).not.toContain('tok-secret-value')
  })
})

describe('buildGamesQuery', () => {
  it('removes characters that end the quoted title', () => {
    expect(quoteTitle('A "quoted" \\ title\nnext')).toBe(
      'A  quoted    title next',
    )
    const query = buildGamesQuery('X"; fields *; where id > 0; "', 2023)
    expect(query.startsWith('search "X ; fields *; where id > 0;";')).toBe(true)
    expect(query.match(/"/g)).toHaveLength(2)
  })

  it('limits the release date to the year and its neighbours', () => {
    const query = buildGamesQuery('Game', 2023)
    expect(query).toContain(
      `first_release_date >= ${String(Date.UTC(2022, 0, 1) / 1000)}`,
    )
    expect(query).toContain(
      `first_release_date < ${String(Date.UTC(2025, 0, 1) / 1000)}`,
    )
  })
})
