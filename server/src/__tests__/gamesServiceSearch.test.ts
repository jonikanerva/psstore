import { Duration, Effect, Exit, Layer } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { UpstreamRateLimited, UpstreamUnavailable } from '../errors/errors.js'
import type { SearchCandidate } from '../domain/listing.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import { productToConcept } from '../sony/mapper.js'
import {
  SonyClient,
  type ProductDetailResult,
  type SearchPage,
} from '../sony/sonyClient.js'

const productId = (n: number): string =>
  `EP0001-PPSA${String(n).padStart(5, '0')}_00-SEARCH${String(n).padStart(10, '0')}`

const known = (n: number): SearchCandidate => ({
  kind: 'known',
  concept: productToConcept({
    id: productId(n),
    name: `Game ${String(n)}`,
    media: [],
    price: { basePrice: '€9,99', discountedPrice: '€9,99' },
  }),
})

const unverified = (n: number): SearchCandidate => ({
  kind: 'unverified',
  productId: productId(n),
  concept: {
    id: String(n),
    name: `Concept ${String(n)}`,
    price: null,
    products: [{ id: productId(n) }],
  },
})

type PageFn = (
  term: string,
  offset: number,
  size: number,
) => Effect.Effect<SearchPage, UpstreamUnavailable | UpstreamRateLimited>

let pageFor: PageFn
let detailFor: (id: string) => Effect.Effect<ProductDetailResult>
let pageCalls: { term: string; offset: number; size: number }[]

const DETAIL: ProductDetailResult = {
  releaseDate: '2024-01-01T00:00:00Z',
  media: [],
  genres: ['Action'],
  description: '',
  storeDisplayClassification: 'FULL_GAME',
  platforms: ['PS5'],
}

const FakeSony = Layer.succeed(SonyClient, {
  fetchConceptsByFeature: () => Effect.succeed([]),
  fetchPlusMonthly: () => Effect.succeed([]),
  fetchProductPrice: () => Effect.succeed({ plusOffer: null, standard: null }),
  fetchProductDetail: (id) => detailFor(id),
  fetchSearchPage: (term, offset, size) => {
    pageCalls.push({ term, offset, size })
    return pageFor(term, offset, size)
  },
})

const run = <A, E>(
  use: (svc: GamesServiceApi) => Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    GamesService.pipe(
      Effect.flatMap(use),
      Effect.provide(GamesServiceLive.pipe(Layer.provide(FakeSony))),
    ),
  )

const page = (
  candidates: readonly SearchCandidate[],
  isLast: boolean,
): Effect.Effect<SearchPage> =>
  Effect.succeed({ candidates, isLast, rawCount: candidates.length })

// A raw result list of `total` known games, served in Sony-sized windows.
const windowed =
  (total: number): PageFn =>
  (_term, offset, size) =>
    page(
      Array.from(
        { length: Math.max(0, Math.min(size, total - offset)) },
        (_, i) => known(offset + i),
      ),
      offset + size >= total,
    )

const value = async (
  use: (svc: GamesServiceApi) => ReturnType<GamesServiceApi['searchGames']>,
) => {
  const exit = await run(use)
  if (!Exit.isSuccess(exit)) {
    throw new Error('expected success')
  }
  return exit.value
}

beforeEach(() => {
  pageCalls = []
  pageFor = () => page([], true)
  detailFor = () => Effect.succeed(DETAIL)
})

describe('gamesService searchGames', () => {
  it('keeps Sony relevance order and enriches the release date and genres', async () => {
    pageFor = () => page([known(3), known(1), known(2)], true)

    const result = await value((s) => s.searchGames('game'))

    expect(result.games.map((game) => game.name)).toEqual([
      'Game 3',
      'Game 1',
      'Game 2',
    ])
    expect(result.games.every((game) => game.date === DETAIL.releaseDate)).toBe(
      true,
    )
    expect(result.games[0]?.genres).toEqual(['Action'])
    expect(result.nextOffset).toBeNull()
  })

  it('requests the term, offset, and size it was given', async () => {
    pageFor = windowed(10)

    await value((s) => s.searchGames('elden', 20, 7))

    expect(pageCalls).toEqual([{ term: 'elden', offset: 20, size: 7 }])
  })

  it('takes nextOffset from isLast and the raw page, not the narrowed length', async () => {
    pageFor = () => page([known(1)], false)

    const result = await value((s) => s.searchGames('x', 100, 50))

    expect(result.games).toHaveLength(1)
    expect(result.nextOffset).toBe(150)
  })

  it('ends at exactly one full page of 50 raw results', async () => {
    pageFor = windowed(50)

    const result = await value((s) => s.searchGames('x', 0, 50))

    expect(result.games).toHaveLength(50)
    expect(result.nextOffset).toBeNull()
  })

  it('offers a second page for 51 raw results', async () => {
    pageFor = windowed(51)

    const first = await value((s) => s.searchGames('x', 0, 50))
    const second = await value((s) => s.searchGames('x', 50, 50))

    expect(first.games).toHaveLength(50)
    expect(first.nextOffset).toBe(50)
    expect(second.games).toHaveLength(1)
    expect(second.nextOffset).toBeNull()
  })

  it('returns an empty last page without a next offset', async () => {
    const result = await value((s) => s.searchGames('xyzzyqq'))

    expect(result).toEqual({ games: [], totalCount: 0, nextOffset: null })
    expect(pageCalls).toHaveLength(1)
  })

  it('reads at most three raw pages when each narrows to zero games', async () => {
    pageFor = () => page([], false)

    const result = await value((s) => s.searchGames('the', 0, 50))

    expect(pageCalls.map((call) => call.offset)).toEqual([0, 50, 100])
    expect(result.games).toEqual([])
    expect(result.nextOffset).toBe(150)
  })

  it('stops reading once a raw page yields games', async () => {
    pageFor = (_term, offset) =>
      offset === 0 ? page([], false) : page([known(7)], false)

    const result = await value((s) => s.searchGames('the', 0, 50))

    expect(pageCalls.map((call) => call.offset)).toEqual([0, 50])
    expect(result.games.map((game) => game.name)).toEqual(['Game 7'])
    expect(result.nextOffset).toBe(100)
  })

  it('stops at the last page even when it narrows to zero games', async () => {
    pageFor = (_term, offset) =>
      offset === 0 ? page([], false) : page([], true)

    const result = await value((s) => s.searchGames('the', 0, 50))

    expect(pageCalls).toHaveLength(2)
    expect(result.nextOffset).toBeNull()
  })

  it('keeps an unverified concept only when its detail is a PS5 game', async () => {
    pageFor = () => page([unverified(1), unverified(2), unverified(3)], true)
    detailFor = (id) =>
      Effect.succeed(
        id === productId(1)
          ? DETAIL
          : id === productId(2)
            ? { ...DETAIL, platforms: ['PS4'] }
            : { media: [], genres: [], description: '' },
      )

    const result = await value((s) => s.searchGames('x'))

    expect(result.games.map((game) => game.id)).toEqual([productId(1)])
  })

  it('drops an unverified concept whose classification is not a game', async () => {
    pageFor = () => page([unverified(1)], true)
    detailFor = () =>
      Effect.succeed({ ...DETAIL, storeDisplayClassification: 'LEVEL' })

    const result = await value((s) => s.searchGames('x'))

    expect(result.games).toEqual([])
  })

  it('does not cache: two identical calls reach Sony twice', async () => {
    pageFor = windowed(3)

    await value((s) =>
      s.searchGames('same').pipe(Effect.andThen(s.searchGames('same'))),
    )

    expect(pageCalls).toHaveLength(2)
  })

  it('propagates a typed upstream failure instead of an empty result', async () => {
    pageFor = () => Effect.fail(new UpstreamUnavailable({ message: 'down' }))

    const exit = await run((s) => s.searchGames('x'))

    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain('UpstreamUnavailable')
  })

  it('propagates a rate limit', async () => {
    pageFor = () => Effect.fail(new UpstreamRateLimited({ message: 'slow' }))

    const exit = await run((s) => s.searchGames('x'))

    expect(JSON.stringify(exit)).toContain('UpstreamRateLimited')
  })

  it('bounds the concurrent detail lookups for one page', async () => {
    let inFlight = 0
    let peak = 0
    pageFor = () =>
      page(
        Array.from({ length: 40 }, (_, i) => unverified(i)),
        true,
      )
    detailFor = () =>
      Effect.gen(function* () {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        yield* Effect.sleep(Duration.millis(2))
        inFlight -= 1
        return DETAIL
      })

    const result = await value((s) => s.searchGames('x'))

    expect(result.games).toHaveLength(40)
    expect(peak).toBeLessThanOrEqual(10)
    expect(peak).toBeGreaterThan(1)
  })
})
