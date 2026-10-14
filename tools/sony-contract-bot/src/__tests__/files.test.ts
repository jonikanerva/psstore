import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFormattedJsonFile } from '../io/files.js'
import { pathsFor } from '../io/paths.js'

// The repository root: src/__tests__ → src → sony-contract-bot → tools → root.
const repository = pathsFor(
  fileURLToPath(new URL('../../../../', import.meta.url)),
)

describe('writeFormattedJsonFile', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes JSON in the Prettier format, not the JSON.stringify format', async () => {
    const filePath = path.join(dir, 'nested', 'value.json')
    await writeFormattedJsonFile(filePath, {
      codes: [200],
      empty: {},
      nested: { name: 'x' },
      long: ['a'.repeat(40), 'b'.repeat(40)],
    })
    // Prettier keeps a short array on one line and breaks an array that does
    // not fit in 80 columns. JSON.stringify(value, null, 2) breaks every
    // non-empty array.
    expect(await fs.readFile(filePath, 'utf8')).toBe(
      [
        '{',
        '  "codes": [200],',
        '  "empty": {},',
        '  "nested": {',
        '    "name": "x"',
        '  },',
        '  "long": [',
        `    "${'a'.repeat(40)}",`,
        `    "${'b'.repeat(40)}"`,
        '  ]',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('reproduces the committed manifest byte for byte', async () => {
    // `mise run format-check` accepts the committed manifest, so its text is
    // the Prettier output for its content.
    const committed = await fs.readFile(repository.canonicalManifest, 'utf8')
    const filePath = path.join(dir, 'sony-graphql-manifest.json')
    await writeFormattedJsonFile(filePath, JSON.parse(committed))
    expect(await fs.readFile(filePath, 'utf8')).toBe(committed)
  })
})
