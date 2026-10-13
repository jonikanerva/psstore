import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { genreListSchema } from '../schemas/browse.js'
import { gameDetailSchema, pageResultSchema } from '../schemas/game.js'

// The committed API examples in docs/contracts/api/ (see its README). Each
// example must decode with the shared schema, and the encoded result must be
// the same JSON with the same key order. The Struct codec writes its output in
// schema field order, so a key in another position fails the test. The decode
// rejects an unknown key and a missing required key.

// The Problem Details body of every API failure (RFC 9457, with the `code`
// extension). The shared package does not import the server, so the test
// declares the body. JSON cannot carry `undefined`, so an absent
// `retryAfterSeconds` is an absent key.
const problemSchema = Schema.Struct({
  type: Schema.Literal('about:blank'),
  title: Schema.String,
  status: Schema.Number,
  detail: Schema.String,
  code: Schema.String,
  retryAfterSeconds: Schema.optionalKey(Schema.Number),
})

const roundTrip =
  <T, E>(schema: Schema.Codec<T, E>) =>
  (input: unknown): E =>
    Schema.encodeSync(schema)(
      Schema.decodeUnknownSync(schema)(input, { onExcessProperty: 'error' }),
    )

const cases: ReadonlyArray<readonly [string, (input: unknown) => unknown]> = [
  ['page-first.json', roundTrip(pageResultSchema)],
  ['page-last.json', roundTrip(pageResultSchema)],
  ['game-detail-plus-price.json', roundTrip(gameDetailSchema)],
  ['game-detail-plus-included.json', roundTrip(gameDetailSchema)],
  ['genres.json', roundTrip(genreListSchema)],
  ['error-invalid-request.json', roundTrip(problemSchema)],
  ['error-not-found.json', roundTrip(problemSchema)],
  ['error-game-not-found.json', roundTrip(problemSchema)],
  ['error-session-rejected.json', roundTrip(problemSchema)],
  ['error-unsupported-media-type.json', roundTrip(problemSchema)],
  ['error-payload-too-large.json', roundTrip(problemSchema)],
  ['error-upstream-unavailable.json', roundTrip(problemSchema)],
  ['error-upstream-query-rotated.json', roundTrip(problemSchema)],
  ['error-upstream-rate-limited.json', roundTrip(problemSchema)],
  ['error-upstream-rate-limited-retry-after.json', roundTrip(problemSchema)],
  ['error-internal-error.json', roundTrip(problemSchema)],
]

const examplesDir = new URL('../../../docs/contracts/api/', import.meta.url)

// The shared package has no Node types, so the test reads a file through a
// Vite `?raw` import. Its default export is the file text.
const readExample = async (name: string): Promise<string> => {
  const module: unknown = await import(new URL(`${name}?raw`, examplesDir).href)
  if (
    typeof module === 'object' &&
    module !== null &&
    'default' in module &&
    typeof module.default === 'string'
  ) {
    return module.default
  }
  throw new Error(`${name}: the raw import has no text`)
}

describe('API contract examples', () => {
  for (const [name, check] of cases) {
    it(`${name} round-trips through the shared schema`, async () => {
      const example: unknown = JSON.parse(await readExample(name))
      const encoded = check(example)
      expect(encoded).toStrictEqual(example)
      // toStrictEqual ignores the key order. The JSON text keeps it.
      expect(JSON.stringify(encoded)).toBe(JSON.stringify(example))
    })
  }

  it('has a case for each example in the README table', async () => {
    const readme = await readExample('README.md')
    // The first cell of each table row names one example: | `name.json` | …
    const listed = readme
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => line.slice(3, line.indexOf('`', 3)))
    expect([...listed].sort()).toEqual(cases.map(([name]) => name).sort())
  })

  it('rejects an example with an extra key', () => {
    expect(() =>
      roundTrip(problemSchema)({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'The Sony sign-in is missing or no longer valid.',
        code: 'session_rejected',
        extra: 1,
      }),
    ).toThrow()
  })
})
