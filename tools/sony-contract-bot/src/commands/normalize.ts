import fs from 'node:fs/promises'
import { CORE_FEATURES } from '../contract/constants.js'
import { createManifest } from '../contract/manifest.js'
import { normalizeOperations } from '../contract/normalizer.js'
import { filterOperationsByFinnishPs5EurScope } from '../contract/scopeFilter.js'
import type { CaptureRecord, ContractFeature } from '../contract/types.js'
import { parseCaptureRecordToOperation } from '../capture/parser.js'
import { ensureDir, writeJsonFile } from '../io/files.js'
import { paths } from '../io/paths.js'

interface CaptureEntry extends CaptureRecord {
  feature: ContractFeature
}

const readCaptureEntries = async (): Promise<CaptureEntry[]> => {
  const raw = await fs.readFile(paths.rawCapture, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaptureEntry)
}

export const runNormalize = async (writeManifest: boolean): Promise<void> => {
  const entries = await readCaptureEntries()
  const parsedOperations = entries.map((entry) =>
    parseCaptureRecordToOperation(
      {
        method: entry.method,
        url: entry.url,
        headers: entry.headers,
        status: entry.status,
        responseJson: entry.responseJson,
      },
      entry.feature,
    ),
  )

  const scopedOperations = filterOperationsByFinnishPs5EurScope(parsedOperations)

  if (scopedOperations.length === 0) {
    throw new Error('No fi-fi / PS5 / EUR operations remained after scope filtering.')
  }

  const operations = normalizeOperations(scopedOperations)

  for (const feature of CORE_FEATURES) {
    if (!operations.some((operation) => operation.feature === feature)) {
      throw new Error(`Scope filtering removed required feature coverage: ${feature}`)
    }
  }

  const manifest = createManifest(
    {
      capturedBy: process.env.USER || 'unknown',
      endpointUrl: 'https://web.np.playstation.com/api/graphql/v1/op',
    },
    operations,
  )

  await ensureDir(paths.candidateManifest)
  await writeJsonFile(paths.candidateManifest, manifest)

  if (writeManifest) {
    await writeJsonFile(paths.canonicalManifest, manifest)
  }
}
