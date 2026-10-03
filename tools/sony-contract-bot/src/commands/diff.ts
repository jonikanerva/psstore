import { diffManifests } from '../contract/diff.js'
import { SIGNED_IN_FEATURES } from '../contract/constants.js'
import { renderDiffReport } from '../contract/report.js'
import type { SonyContractManifest } from '../contract/types.js'
import { fileExists, readJsonFile, writeTextFile } from '../io/files.js'
import { paths } from '../io/paths.js'

// Returns whether a candidate manifest was present (i.e. whether the diff was
// actually checked against a fresh capture). The CLI uses this for a breadcrumb;
// the report uses it for the tri-state headline. The canonical-vs-canonical
// fallback and the `--ci` drift throw are unchanged, so a clean checkout with no
// candidate still produces `hasDrift === false` and `sony:diff -- --ci` exits 0.
export const runDiff = async (ci: boolean): Promise<boolean> => {
  if (!(await fileExists(paths.canonicalManifest))) {
    throw new Error(`Canonical manifest not found: ${paths.canonicalManifest}`)
  }

  const base = await readJsonFile<SonyContractManifest>(paths.canonicalManifest)
  const hasCandidate = await fileExists(paths.candidateManifest)
  const next = hasCandidate
    ? await readJsonFile<SonyContractManifest>(paths.candidateManifest)
    : base

  const diff = diffManifests(base, next)
  await writeTextFile(
    paths.diffReport,
    renderDiffReport(
      diff,
      hasCandidate,
      base.operations.filter((operation) =>
        SIGNED_IN_FEATURES.includes(operation.feature),
      ),
    ),
  )

  if (ci && diff.hasDrift) {
    throw new Error(
      'Sony contract drift detected. See docs/contracts/reports/latest-diff.md',
    )
  }

  return hasCandidate
}
