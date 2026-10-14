import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeNormalizedManifest } from '../commands/normalize.js'
import type { SonyContractManifest } from '../contract/types.js'
import { fileExists, readJsonFile } from '../io/files.js'
import { pathsFor } from '../io/paths.js'

// The repository root: src/__tests__ → src → sony-contract-bot → tools → root.
const repository = pathsFor(
  fileURLToPath(new URL('../../../../', import.meta.url)),
)

describe('writeNormalizedManifest', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'normalize-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const committed = async (): Promise<string> =>
    fs.readFile(repository.canonicalManifest, 'utf8')

  it('writes the committed manifest content byte for byte with --write-manifest', async () => {
    // `mise run format-check` accepts the committed manifest, so its text is
    // the Prettier output for its content.
    const text = await committed()
    const target = pathsFor(dir)
    await writeNormalizedManifest(
      await readJsonFile<SonyContractManifest>(repository.canonicalManifest),
      true,
      target,
    )
    expect(await fs.readFile(target.canonicalManifest, 'utf8')).toBe(text)
    expect(await fileExists(target.candidateManifest)).toBe(true)
  })

  it('writes only the candidate without --write-manifest', async () => {
    const target = pathsFor(dir)
    await writeNormalizedManifest(
      await readJsonFile<SonyContractManifest>(repository.canonicalManifest),
      false,
      target,
    )
    expect(await fileExists(target.candidateManifest)).toBe(true)
    expect(await fileExists(target.canonicalManifest)).toBe(false)
  })
})
