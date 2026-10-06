import { Effect, Exit, Layer } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  UpstreamUnavailable,
  type UpstreamRateLimited,
} from '../errors/errors.js'
import {
  GamesService,
  GamesServiceLive,
  type GamesServiceApi,
} from '../services/gamesService.js'
import type { BrowseRequest } from '../sony/queryStrategies.js'
import {
  SonyClient,
  type BrowsePage,
  type ProductDetailResult,
} from '../sony/sonyClient.js'
import type { Concept } from '../sony/types.js'

const ps5 = (n: number): string =>
  `EP0001-PPSA${String(n).padStart(5, '0')}_00-BROWSE${String(n).padStart(10, '0')}`
const ps4 = (n: number): string =>
  `EP0001-CUSA${String(n).padStart(5, '0')}_00-BROWSE${String(n).padStart(10, '0')}`

const concept = (n: number, ids: readonly string[]): Concept => ({
  id: String(n),
  name: `Game ${String(n)}`,
  price: { basePrice: '€19,99', discountedPrice: '€19,99' },
  products: ids.map((id) => ({ id })),
})

const GAME: ProductDetailResult = {
  name: 'Detail name',
  releaseDate: '2024-01-01T00:00:00Z',
  media: [],
  genres: ['Shooter'],
  description: '',
  storeDisplayClassification: 'FULL_GAME',
  platforms: ['PS5'],
}

type PageFn = (
  request: BrowseRequest,
) => Effect.Effect<BrowsePage, UpstreamUnavailable | UpstreamRateLimited>

let pageFor: PageFn
let detailFor: (
  id: string,
) => Effect.Effect<ProductDetailResult, UpstreamUnavailable>
let pageCalls: BrowseRequest[]
let detailCalls: string[]
let genreCalls: number

const FakeSony = Layer.succeed(SonyClient, {
  fetchConceptsByFeature: () => Effect.succeed([]),
  fetchPlusMonthly: () => Effect.succeed([]),
  fetchSearchPage: () =>
    Effect.succeed({ candidates: [], isLast: true, rawCount: 0 }),
  fetchProductPrice: () => Effect.succeed({ plusOffer: null, standard: null }),
  fetchProductDetail: (id) => {
    detailCalls.push(id)
    return detailFor(id)
  },
  fetchBrowsePage: (request) => {
    pageCalls.push(request)
    return pageFor(request)
  },
  fetchGenres: () => {
    genreCalls += 1
    return Effect.succeed([{ key: 'ACTION', name: 'Action' }])
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

const value = async <A, E>(
  use: (svc: GamesServiceApi) => Effect.Effect<A, E>,
): Promise<A> => {
  const exit = await run(use)
  if (!Exit.isSuccess(exit)) {
    throw new Error('expected success')
  }
  return exit.value
}

const page = (
  concepts: readonly Concept[],
  isLast: boolean,
): Effect.Effect<BrowsePage> => Effect.succeed({ concepts, isLast })

beforeEach(() => {
  pageCalls = []
  detailCalls = []
  genreCalls = 0
  pageFor = () => page([], true)
  detailFor = () => Effect.succeed(GAME)
})

describe('getBrowseGames', () => {
  it('passes genre, order and page window to Sony and keeps Sony order', async () => {
    pageFor = () => page([concept(2, [ps5(2)]), concept(1, [ps5(1)])], false)

    const result = await value((svc) =>
      svc.getBrowseGames('FIRST_PERSON_SHOOTER', 'best-selling', 60, 60),
    )

    expect(pageCalls).toEqual([
      {
        genre: 'FIRST_PERSON_SHOOTER',
        order: 'best-selling',
        offset: 60,
        size: 60,
      },
    ])
    expect(result.games.map((game) => game.id)).toEqual([ps5(2), ps5(1)])
    expect(result.games[0]?.date).toBe('2024-01-01T00:00:00.000Z')
    expect(result.games[0]?.genres).toEqual(['Shooter'])
    expect(result.nextOffset).toBe(120)
    expect(result.totalCount).toBe(2)
  })

  it('stops paging at the last Sony page', async () => {
    pageFor = () => page([concept(1, [ps5(1)])], true)
    const result = await value((svc) => svc.getBrowseGames('ACTION', 'newest'))
    expect(result.nextOffset).toBeNull()
  })

  it('prefers the PS5 product over a PS4 first product', async () => {
    pageFor = () => page([concept(1, [ps4(1), ps5(1)])], true)
    const result = await value((svc) =>
      svc.getBrowseGames('ACTION', 'name-asc'),
    )
    expect(result.games.map((game) => game.id)).toEqual([ps5(1)])
    expect(detailCalls).toEqual([ps5(1)])
  })

  it('falls back to the next candidate when the first is not a PS5 game', async () => {
    pageFor = () => page([concept(1, [ps5(1), ps5(2), ps4(3)])], true)
    detailFor = (id) =>
      Effect.succeed(
        id === ps5(1)
          ? { ...GAME, storeDisplayClassification: 'DEMO' }
          : id === ps5(2)
            ? { ...GAME, storeDisplayClassification: 'PREMIUM_EDITION' }
            : { ...GAME, platforms: ['PS4', 'PS5'] },
      )
    const result = await value((svc) =>
      svc.getBrowseGames('ACTION', 'name-asc'),
    )
    expect(result.games.map((game) => game.id)).toEqual([ps4(3)])
    expect(detailCalls).toEqual([ps5(1), ps5(2), ps4(3)])
  })

  it('drops a concept without a product id or without a PS5 game product', async () => {
    pageFor = () =>
      page(
        [
          { id: '10020880', name: 'Concept only', products: [] },
          concept(2, [ps4(2)]),
          concept(3, [ps5(3)]),
        ],
        true,
      )
    detailFor = (id) =>
      Effect.succeed(id === ps4(2) ? { ...GAME, platforms: ['PS4'] } : GAME)
    const result = await value((svc) =>
      svc.getBrowseGames('ACTION', 'name-asc'),
    )
    expect(result.games.map((game) => game.id)).toEqual([ps5(3)])
  })

  it('drops a concept whose lookup failed and keeps the others', async () => {
    pageFor = () => page([concept(1, [ps5(1)]), concept(2, [ps5(2)])], true)
    detailFor = (id) =>
      id === ps5(1)
        ? Effect.fail(new UpstreamUnavailable({ message: 'down' }))
        : Effect.succeed(GAME)
    const result = await value((svc) =>
      svc.getBrowseGames('ACTION', 'name-asc'),
    )
    expect(result.games.map((game) => game.id)).toEqual([ps5(2)])
  })

  it('fails the page when every lookup failed, never an empty genre', async () => {
    pageFor = () => page([concept(1, [ps5(1)]), concept(2, [ps5(2)])], true)
    detailFor = () => Effect.fail(new UpstreamUnavailable({ message: 'down' }))
    const exit = await run((svc) => svc.getBrowseGames('ACTION', 'name-asc'))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('propagates a failed grid request', async () => {
    pageFor = () => Effect.fail(new UpstreamUnavailable({ message: 'down' }))
    const exit = await run((svc) => svc.getBrowseGames('ACTION', 'name-asc'))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('reads the next raw page when a page narrows to zero games', async () => {
    pageFor = (request) =>
      request.offset === 0
        ? page([concept(1, [ps4(1)])], false)
        : page([concept(2, [ps5(2)])], true)
    detailFor = (id) =>
      Effect.succeed(id === ps4(1) ? { ...GAME, platforms: ['PS4'] } : GAME)
    const result = await value((svc) =>
      svc.getBrowseGames('ACTION', 'name-asc', 0, 1),
    )
    expect(pageCalls.map((call) => call.offset)).toEqual([0, 1])
    expect(result.games.map((game) => game.id)).toEqual([ps5(2)])
    expect(result.nextOffset).toBeNull()
  })

  it('reads at most three raw pages for one request', async () => {
    pageFor = (request) => page([concept(request.offset, [ps4(1)])], false)
    detailFor = () => Effect.succeed({ ...GAME, platforms: ['PS4'] })
    const result = await value((svc) =>
      svc.getBrowseGames('ACTION', 'name-asc', 0, 1),
    )
    expect(pageCalls).toHaveLength(3)
    expect(result.games).toEqual([])
    expect(result.nextOffset).toBe(3)
  })

  it('shares one cached page between equal requests', async () => {
    pageFor = () => page([concept(1, [ps5(1)])], true)
    await value((svc) =>
      Effect.all([
        svc.getBrowseGames('ACTION', 'name-asc'),
        svc.getBrowseGames('ACTION', 'name-asc'),
        svc.getBrowseGames('ACTION', 'name-desc'),
      ]),
    )
    expect(pageCalls.map((call) => call.order)).toEqual([
      'name-asc',
      'name-desc',
    ])
  })
})

describe('getGenres', () => {
  it('serves the genre list and caches it', async () => {
    const result = await value((svc) =>
      Effect.all([svc.getGenres(), svc.getGenres()]),
    )
    expect(result[0]).toEqual({ genres: [{ key: 'ACTION', name: 'Action' }] })
    expect(genreCalls).toBe(1)
  })
})

describe('getGameById for a BROWSE card', () => {
  it('opens the product that BROWSE chose', async () => {
    pageFor = () => page([concept(1, [ps4(1), ps5(1)])], true)
    const game = await value((svc) =>
      svc
        .getBrowseGames('ACTION', 'name-asc')
        .pipe(
          Effect.flatMap((result) =>
            svc.getGameById(result.games[0]?.id ?? ''),
          ),
        ),
    )
    expect(game.id).toBe(ps5(1))
  })
})
