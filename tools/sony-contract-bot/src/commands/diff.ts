import { diffManifests } from '../contract/diff.js'
import { renderDiffReport } from '../contract/report.js'
import type { SonyContractManifest } from '../contract/types.js'
import { fileExists, readJsonFile, writeTextFile } from '../io/files.js'
import { paths } from '../io/paths.js'

export const runDiff = async (ci: boolean): Promise<void> => {
  if (!(await fileExists(paths.canonicalManifest))) {
    throw new Error(`Canonical manifest not found: ${paths.canonicalManifest}`)
  }

  const base = await readJsonFile<SonyContractManifest>(paths.canonicalManifest)
  const next = (await fileExists(paths.candidateManifest))
    ? await readJsonFile<SonyContractManifest>(paths.candidateManifest)
    : base

  const diff = diffManifests(base, next)
  await writeTextFile(paths.diffReport, renderDiffReport(diff))

  if (ci && diff.hasDrift) {
    throw new Error('Sony contract drift detected. See docs/contracts/reports/latest-diff.md')
  }
}
