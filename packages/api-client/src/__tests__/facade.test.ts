import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  BROWSE_ORDERS,
  createApi,
  isBrowseOrder,
  isGenreKey,
  problemStatus,
  type ProblemCode,
} from '../index'
import { zProblemCode } from '../generated/zod.gen'

// The facade against a fake `fetch`. Each test builds the response that the
// server, or an intermediary, could send, and checks what the web app gets.

const BASE = 'http://api.test'

const game = {
  id: 'EP0001-PPSA00001_00-SAMPLEGAME000001',
  name: 'Sample',
  date: '2026-10-14T21:00:00Z',
  url: 'https://image.example/cover.png',
  price: '€49,95',
  originalPrice: '',
  discountText: '',
  discountDate: '',
  screenshots: [],
  videos: [],
  genres: [],
  description: '',
  studio: '',
  preOrder: false,
  plusUpsellText: null,
  plusOffer: null,
  idKind: 'product',
}

const page = { games: [game], totalCount: 1, nextOffset: null }

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': type },
  })

const problemBody = (code: ProblemCode, extra: object = {}) => ({
  type: 'about:blank',
  title: 'Title',
  status: problemStatus(code),
  detail: 'A fixed text.',
  code,
  ...extra,
})

const problem = (code: ProblemCode, extra: object = {}) =>
  json(
    problemBody(code, extra),
    problemStatus(code),
    'application/problem+json',
  )

const setup = (respond: (request: Request) => Response | Promise<Response>) => {
  const requests: Request[] = []
  const fetch = vi.fn((input: RequestInfo | URL) => {
    if (!(input instanceof Request)) {
      throw new TypeError('the client sends a Request')
    }
    requests.push(input)
    return Promise.resolve(respond(input))
  })
  return { api: createApi({ baseUrl: () => BASE, fetch }), requests }
}

const failure = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending
  } catch (error) {
    return error
  }
  throw new Error('the call did not fail')
}

const apiError = async (pending: Promise<unknown>): Promise<ApiError> => {
  const error = await failure(pending)
  expect(error).toBeInstanceOf(ApiError)
  if (!(error instanceof ApiError)) throw new Error('not an ApiError')
  return error
}

describe('success bodies', () => {
  it('returns a valid page and sends the page query', async () => {
    const { api, requests } = setup(() => json(page))
    await expect(api.fetchNewGames(60, 30)).resolves.toEqual(page)
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${BASE}/api/games/new?offset=60&size=30`,
    ])
  })

  it('validates a body that arrives with a text content type', async () => {
    const { api } = setup(
      () => new Response(JSON.stringify(page), { status: 200 }),
    )
    await expect(api.fetchUpcomingGames(0, 60)).resolves.toEqual(page)
  })

  it('rejects a success body that breaks the contract', async () => {
    for (const body of [
      { ...page, totalCount: '1' },
      { games: [{ ...game, idKind: 'bundle' }], totalCount: 1, nextOffset: 0 },
      { games: [{ ...game, id: '' }], totalCount: 1, nextOffset: null },
      { games: [game], totalCount: 1 },
      {
        games: [{ ...game, plusOffer: { kind: 'price' } }],
        totalCount: 1,
        nextOffset: null,
      },
    ]) {
      const { api } = setup(() => json(body))
      const error = await apiError(api.fetchDiscountedGames(0, 60))
      expect(error.status).toBe(200)
      expect(error.code).toBe('invalid_response')
    }
  })

  it('rejects a success response that is not JSON', async () => {
    const { api } = setup(
      () =>
        new Response('<!doctype html><title>spa</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    )
    const error = await apiError(api.fetchMonthlyGames(0, 60))
    expect(error.code).toBe('invalid_response')
  })

  // The SDK returns `{}` without its validator for these answers.
  it('rejects a success answer without a body', async () => {
    for (const response of [
      new Response(null, { status: 204 }),
      new Response('', {
        status: 200,
        headers: { 'Content-Length': '0', 'Content-Type': 'application/json' },
      }),
    ]) {
      const { api } = setup(() => response.clone())
      const error = await apiError(api.fetchGame(game.id))
      expect([error.status, error.code]).toEqual([
        response.status,
        'invalid_response',
      ])
    }
  })

  it('rejects a critic score outside 0 to 100 and a null score', async () => {
    for (const criticScore of [101, -1, 1.5, null]) {
      const { api } = setup(() => json({ ...game, criticScore }))
      const error = await apiError(api.fetchGame(game.id))
      expect(error.code).toBe('invalid_response')
    }
  })

  // An unknown key does not fail validation: the server may add a field
  // before the client knows it. The SDK validates the body and returns it
  // unchanged, so the client sees the key but reads only the known fields.
  it('accepts an unknown key and keeps the known fields', async () => {
    const { api } = setup(() =>
      json({ ...game, criticScore: 88, extra: 'unknown' }),
    )
    await expect(api.fetchGame(game.id)).resolves.toMatchObject({
      ...game,
      criticScore: 88,
    })
    const list = setup(() =>
      json({ ...page, extra: 1, games: [{ ...game, extra: 2 }] }),
    )
    await expect(list.api.fetchNewGames(0, 60)).resolves.toMatchObject(page)
  })
})

describe('error bodies', () => {
  it('maps each known problem code with its status', async () => {
    const codes = zProblemCode.options
    expect(codes).toHaveLength(10)
    for (const code of codes) {
      const { api } = setup(() => problem(code))
      const error = await apiError(api.fetchNewGames(0, 60))
      expect(error.status).toBe(problemStatus(code))
      expect(error.code).toBe(code)
      expect(error.retryAfterSeconds).toBeUndefined()
    }
  })

  it('keeps the retry delay of a rate-limited problem', async () => {
    const { api } = setup(() =>
      problem('upstream_rate_limited', { retryAfterSeconds: 7 }),
    )
    const error = await apiError(api.fetchGenres())
    expect(error.code).toBe('upstream_rate_limited')
    expect(error.retryAfterSeconds).toBe(7)
  })

  it('maps an unknown code to a generic error with the status', async () => {
    const { api } = setup(() =>
      json(
        { ...problemBody('not_found'), code: 'teapot', status: 418 },
        418,
        'application/problem+json',
      ),
    )
    const error = await apiError(api.fetchGame('x'))
    expect(error.status).toBe(418)
    expect(error.code).toBe('unrecognized_error')
  })

  it('handles an invalid error body safely', async () => {
    for (const body of [
      {},
      { ...problemBody('game_not_found'), detail: 5 },
      { code: 'game_not_found' },
      ['game_not_found'],
      null,
      'game_not_found',
    ]) {
      const { api } = setup(() => json(body, 404, 'application/problem+json'))
      const error = await apiError(api.fetchGame('x'))
      expect(error.status).toBe(404)
      expect(error.code).toBe('unrecognized_error')
    }
  })

  it('does not trust a known code with another status', async () => {
    const { api } = setup(() =>
      json(problemBody('session_rejected'), 404, 'application/problem+json'),
    )
    const error = await apiError(api.fetchGame('x'))
    expect(error.status).toBe(404)
    expect(error.code).toBe('unrecognized_error')
  })

  it('handles a non-JSON answer of an intermediary', async () => {
    for (const response of [
      new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
      new Response(null, { status: 503 }),
      new Response('Unsupported', { status: 415 }),
    ]) {
      const { api } = setup(() => response.clone())
      const error = await apiError(api.fetchWishlistGames())
      expect(error.status).toBe(response.status)
      expect(error.code).toBe('unrecognized_error')
    }
  })
})

describe('requests', () => {
  it('encodes the search term, the browse query, and the game id', async () => {
    const { api, requests } = setup((request) =>
      request.url.includes('/api/games/E') ? json(game) : json(page),
    )
    await api.fetchSearchGames('a b&c', 50, 5)
    await api.fetchBrowseGames('MUSIC/RHYTHM', 'name-asc', 0, 60)
    await api.fetchGame('EP 1/2')
    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/api/games/search?q=a%20b%26c&offset=50&size=5`,
      `${BASE}/api/games/browse?genre=MUSIC%2FRHYTHM&order=name-asc&offset=0&size=60`,
      `${BASE}/api/games/EP%201%2F2`,
    ])
  })

  it('sends signed-in calls without the HTTP cache and with same-origin credentials', async () => {
    const { api, requests } = setup((request) =>
      request.method === 'GET'
        ? json(page)
        : new Response(null, { status: 204 }),
    )
    await api.fetchPurchasedGames()
    await api.fetchWishlistGames()
    await expect(api.signIn('synthetic-npsso-0123456789abcdef')).resolves.toBe(
      undefined,
    )
    await expect(api.signOut()).resolves.toBe(undefined)
    expect(
      requests.map((r) => [r.method, r.url, r.cache, r.credentials]),
    ).toEqual([
      ['GET', `${BASE}/api/games/purchased`, 'no-store', 'same-origin'],
      ['GET', `${BASE}/api/games/wishlist`, 'no-store', 'same-origin'],
      ['POST', `${BASE}/api/session`, 'no-store', 'same-origin'],
      ['DELETE', `${BASE}/api/session`, 'no-store', 'same-origin'],
    ])
    const signIn = requests[2]
    expect(signIn?.headers.get('Content-Type')).toBe('application/json')
    expect(signIn?.headers.get('Cookie')).toBeNull()
    await expect(signIn?.text()).resolves.toBe(
      '{"npsso":"synthetic-npsso-0123456789abcdef"}',
    )
  })

  it('maps a rejected sign-in to session_rejected', async () => {
    const { api } = setup(() => problem('session_rejected'))
    const error = await apiError(api.signIn('synthetic-npsso-0123456789abcdef'))
    expect([error.status, error.code]).toEqual([401, 'session_rejected'])
  })

  it('forwards the abort signal and keeps the abort error', async () => {
    const controller = new AbortController()
    const { api, requests } = setup(
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal.addEventListener('abort', () => {
            const reason: unknown = request.signal.reason
            reject(reason instanceof Error ? reason : new Error('aborted'))
          })
        }),
    )
    const pending = api.fetchNewGames(0, 60, controller.signal)
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    controller.abort()
    const error = await failure(pending)
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(requests[0]?.signal.aborted).toBe(true)
  })

  it('keeps a network error', async () => {
    const network = new TypeError('Failed to fetch')
    const { api } = setup(() => {
      throw network
    })
    await expect(failure(api.fetchGenres())).resolves.toBe(network)
  })
})

describe('contract values', () => {
  it('lists the browse orders and checks genre keys like the contract', () => {
    expect(BROWSE_ORDERS).toEqual([
      'best-selling',
      'most-downloaded',
      'newest',
      'oldest',
      'name-asc',
      'name-desc',
    ])
    expect(isBrowseOrder('name-asc')).toBe(true)
    expect(isBrowseOrder('Newest')).toBe(false)
    expect(isBrowseOrder(1)).toBe(false)
    expect(isGenreKey('MUSIC/RHYTHM')).toBe(true)
    expect(isGenreKey('ROLE_PLAYING_GAMES')).toBe(true)
    expect(isGenreKey('action')).toBe(false)
    expect(isGenreKey('')).toBe(false)
    expect(isGenreKey('A'.repeat(65))).toBe(false)
  })
})
