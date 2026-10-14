import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { readProbeConfig, WISHLIST_PROBE } from '../commands/probeSignedIn.js'
import { validateBackendCompatibility } from '../compat/backend.js'
import {
  readProductionRustFile,
  readProductionRustSources,
} from '../compat/rustSources.js'
import { addPinnedOperations } from '../contract/pinnedOperations.js'
import {
  parseSonyConstants,
  readSonyConstants,
  sonyConstant,
} from '../contract/sonyConstants.js'
import type { SonyContractManifest } from '../contract/types.js'
import { readJsonFile } from '../io/files.js'
import { pathsFor } from '../io/paths.js'

// The repository root: src/__tests__ → src → sony-contract-bot → tools → root.
const repository = pathsFor(
  fileURLToPath(new URL('../../../../', import.meta.url)),
)

// Every constant that the bot reads: the compatibility check, the pinned
// operations, and the signed-in probes.
const KEYS_THE_BOT_READS = [
  'SONY_GRAPHQL_URL',
  'SONY_OPERATION_NAME',
  'SONY_PRODUCT_OPERATION_NAME',
  'SONY_PRODUCT_BY_ID_HASH',
  'SONY_PRODUCT_PRICE_OPERATION_NAME',
  'SONY_PRODUCT_PRICE_HASH',
  'SONY_SEARCH_OPERATION_NAME',
  'SONY_SEARCH_HASH',
  'SONY_PURCHASED_OPERATION_NAME',
  'SONY_PURCHASED_HASH',
  'SONY_WISHLIST_OPERATION_NAME',
  'SONY_WISHLIST_HASH',
  'SONY_AUTH_BASE_URL',
  'SONY_AUTH_CLIENT_ID',
  'SONY_AUTH_REDIRECT_URI',
  'SONY_AUTH_SCOPE',
  'SONY_AUTH_BASIC_HEADER',
  'SONY_LOCALE',
]

describe('parseSonyConstants', () => {
  it('reads a flat object of strings', () => {
    const constants = parseSonyConstants('{"A": "1", "B": "two"}')
    expect([...constants]).toEqual([
      ['A', '1'],
      ['B', 'two'],
    ])
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['an array', '["a"]'],
    ['null', 'null'],
    ['a number value', '{"SONY_LOCALE": 1}'],
    ['an object value', '{"SONY_LOCALE": {"value": "en-fi"}}'],
    ['a null value', '{"SONY_LOCALE": null}'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseSonyConstants(text)).toThrow(
      'docs/contracts/sony-constants.json must be a JSON object with string values only',
    )
  })

  it('reads a missing key and an empty value as no value', () => {
    const constants = parseSonyConstants('{"EMPTY": ""}')
    expect(sonyConstant(constants, 'EMPTY')).toBeNull()
    expect(sonyConstant(constants, 'MISSING')).toBeNull()
    // A key of Object.prototype is not a constant.
    expect(sonyConstant(constants, 'toString')).toBeNull()
  })
})

describe('the committed constants file and the server sources', () => {
  it('holds every key that the bot reads, each with a value', async () => {
    const constants = await readSonyConstants(repository.sonyConstants)
    for (const key of KEYS_THE_BOT_READS) {
      expect(sonyConstant(constants, key), key).not.toBeNull()
    }
  })

  it('passes the compatibility check against the committed manifest', async () => {
    const manifest = await readJsonFile<SonyContractManifest>(
      repository.canonicalManifest,
    )
    const context = {
      sonyConstants: await readSonyConstants(repository.sonyConstants),
      sonyClientText: await readProductionRustSources(repository.sonyClientDir),
      mapperText: await readProductionRustFile(repository.mapperFile),
      serviceText: await readProductionRustFile(repository.serviceFile),
    }
    expect(() => {
      validateBackendCompatibility(manifest, context)
    }).not.toThrow()
  })

  it('gives both signed-in probes a complete configuration', async () => {
    const constants = await readSonyConstants(repository.sonyConstants)
    expect(readProbeConfig(constants).operationName).toBe(
      'getPurchasedGameList',
    )
    expect(readProbeConfig(constants, WISHLIST_PROBE).operationName).toBe(
      'storeRetrieveWishlist',
    )
  })

  it('gives the pinned operations their names and hashes', async () => {
    const constants = await readSonyConstants(repository.sonyConstants)
    const canonical = (
      await readJsonFile<SonyContractManifest>(repository.canonicalManifest)
    ).operations
    const productName = sonyConstant(constants, 'SONY_PRODUCT_OPERATION_NAME')
    const probe = vi.fn().mockResolvedValue(undefined)
    const result = await addPinnedOperations(
      canonical.filter((entry) => entry.operation_name !== productName),
      canonical,
      constants,
      probe,
      vi.fn(),
    )
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: productName,
        hash: sonyConstant(constants, 'SONY_PRODUCT_BY_ID_HASH'),
      }),
    )
    expect(result.map((entry) => entry.operation_name)).toContain(productName)
  })
})
