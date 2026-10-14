import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateBackendCompatibility } from '../compat/backend.js'
import {
  isProductionRustFile,
  readProductionRustSources,
  withoutInlineTestModule,
} from '../compat/rustSources.js'
import { readSonyConstants } from '../contract/sonyConstants.js'
import type { SonyContractManifest } from '../contract/types.js'
import { readJsonFile } from '../io/files.js'
import { pathsFor } from '../io/paths.js'

const repository = pathsFor(
  fileURLToPath(new URL('../../../../', import.meta.url)),
)

describe('isProductionRustFile', () => {
  it.each([
    ['catalog.rs', true],
    [path.join('catalog', 'grid.rs'), true],
    ['contests.rs', true],
    ['tests.rs', false],
    [path.join('catalog', 'tests.rs'), false],
    [path.join('catalog', 'tests', 'client.rs'), false],
    [path.join('tests', 'deep', 'fixture.rs'), false],
    ['notes.md', false],
  ])('%s → %s', (file, expected) => {
    expect(isProductionRustFile(file)).toBe(expected)
  })
})

describe('withoutInlineTestModule', () => {
  it('drops an inline test module and the text after it', () => {
    expect(
      withoutInlineTestModule(
        'fn a() {}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n}\n',
      ),
    ).toBe('fn a() {}\n\n')
  })

  it('drops a test module with more attributes', () => {
    expect(
      withoutInlineTestModule(
        'fn a() {}\n#[cfg(test)]\n#[allow(clippy::x, reason = "y")]\nmod checks {}\n',
      ),
    ).toBe('fn a() {}\n')
  })

  it('keeps the code after an out-of-line test module declaration', () => {
    const source = '#[cfg(test)]\nmod tests;\n\nfn a() {}\n'
    expect(withoutInlineTestModule(source)).toBe(source)
  })
})

describe('readProductionRustSources', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-sources-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const write = async (file: string, text: string): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), text)
  }

  // Production code with every anchor except `"productRetrieve"`.
  const production = [
    '.header("x-apollo-operation-name", operation)',
    '.get("categoryGridRetrieve")',
    'data.get("universalSearch")',
    '&contract.purchased_hash,',
    '&contract.wishlist_hash,',
  ].join('\n')

  const check = async (): Promise<void> => {
    const manifest = await readJsonFile<SonyContractManifest>(
      repository.canonicalManifest,
    )
    validateBackendCompatibility(manifest, {
      sonyConstants: await readSonyConstants(repository.sonyConstants),
      sonyClientText: await readProductionRustSources(dir),
      mapperText: 'pub fn concept_to_game(',
      serviceText: 'sony.concepts_by_feature(feature, size, 0)',
    })
  }

  it('does not let test code satisfy an anchor', async () => {
    await write('catalog.rs', `${production}\n#[cfg(test)]\nmod tests;\n`)
    await write(
      'catalog/grid.rs',
      'fn grid() {}\n#[cfg(test)]\nmod tests {\n    json!({"data": {"productRetrieve": {}}});\n}\n',
    )
    await write('catalog/tests.rs', '.get("productRetrieve")\n')
    await write('catalog/tests/decode.rs', '.get("productRetrieve")\n')
    await write('tests/fixture.rs', '.get("productRetrieve")\n')

    const text = await readProductionRustSources(dir)
    expect(text).toContain('"categoryGridRetrieve"')
    expect(text).not.toContain('productRetrieve')
    await expect(check()).rejects.toThrow(/productRetrieve/)
  })

  it('accepts the anchor in production code', async () => {
    await write('catalog.rs', production)
    await write('catalog/product.rs', '.get("productRetrieve")\n')
    await expect(check()).resolves.toBeUndefined()
  })

  it('fails when the directory has no production source', async () => {
    await write('tests.rs', 'fn only_tests() {}\n')
    await expect(readProductionRustSources(dir)).rejects.toThrow(
      /No production Rust sources/,
    )
  })
})
