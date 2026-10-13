import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { ApiError, createApi } from '../index'
import {
  zGameDetail,
  zGenreList,
  zPageResult,
  zProblem,
} from '../generated/zod.gen'

// The committed API examples in docs/contracts/api/ (see its README) against
// the generated validators. The Rust test `crates/server/tests/api_contract.rs`
// checks that the server writes these bytes, so together the two tests check
// the server and the client against one set of examples.

const examplesDir = new URL('../../../../docs/contracts/api/', import.meta.url)

const read = (name: string): string =>
  readFileSync(new URL(name, examplesDir), 'utf8')

const cases: ReadonlyArray<readonly [string, ZodType]> = [
  ['page-first.json', zPageResult],
  ['page-last.json', zPageResult],
  ['game-detail-plus-price.json', zGameDetail],
  ['game-detail-plus-included.json', zGameDetail],
  ['genres.json', zGenreList],
  ['error-invalid-request.json', zProblem],
  ['error-not-found.json', zProblem],
  ['error-game-not-found.json', zProblem],
  ['error-session-rejected.json', zProblem],
  ['error-unsupported-media-type.json', zProblem],
  ['error-payload-too-large.json', zProblem],
  ['error-upstream-unavailable.json', zProblem],
  ['error-upstream-query-rotated.json', zProblem],
  ['error-upstream-rate-limited.json', zProblem],
  ['error-upstream-rate-limited-retry-after.json', zProblem],
  ['error-internal-error.json', zProblem],
]

// The rows of the README table: | `name.json` | route | status | content |
const readmeRows = (): ReadonlyArray<readonly [string, number]> =>
  read('README.md')
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim())
      return [(cells[1] ?? '').replaceAll('`', ''), Number(cells[3])] as const
    })

describe('API contract examples', () => {
  for (const [name, schema] of cases) {
    it(`${name} matches the generated schema`, () => {
      const example: unknown = JSON.parse(read(name))
      const parsed = schema.safeParse(example)
      expect(parsed.error).toBeUndefined()
      // An object schema drops an unknown key, so an equal value shows that
      // the example has only contract keys. The key order is not compared
      // here: the OpenAPI schema lists the `kind` tag of `PlusOffer` after
      // its fields. The Rust test pins the key order byte for byte.
      expect(parsed.data).toStrictEqual(example)
    })
  }

  it('maps each error example to its code and status', async () => {
    const statuses = new Map(readmeRows())
    for (const [name] of cases.filter(([file]) => file.startsWith('error-'))) {
      const body = read(name)
      const status = statuses.get(name) ?? 0
      const api = createApi({
        baseUrl: () => 'http://api.test',
        fetch: () =>
          Promise.resolve(
            new Response(body, {
              status,
              headers: { 'Content-Type': 'application/problem+json' },
            }),
          ),
      })
      const error = await api.fetchNewGames(0, 60).catch((e: unknown) => e)
      expect(error, name).toBeInstanceOf(ApiError)
      const example = zProblem.parse(JSON.parse(body))
      expect(error, name).toMatchObject({
        status: example.status,
        code: example.code,
      })
      expect(example.status, name).toBe(status)
    }
  })

  it('has a case for each example in the README table', () => {
    expect(
      readmeRows()
        .map(([name]) => name)
        .sort(),
    ).toEqual(cases.map(([name]) => name).sort())
  })

  it('rejects an example with a wrong value', () => {
    const example = zProblem.parse(
      JSON.parse(read('error-session-rejected.json')),
    )
    expect(zProblem.safeParse({ ...example, code: 'teapot' }).success).toBe(
      false,
    )
  })
})
