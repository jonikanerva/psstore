import { validateBackendCompatibility } from '../compat/backend.js'
import {
  readProductionRustFile,
  readProductionRustSources,
} from '../compat/rustSources.js'
import { readSonyConstants } from '../contract/sonyConstants.js'
import { validateManifest } from '../contract/validator.js'
import type { SonyContractManifest } from '../contract/types.js'
import { fileExists, readJsonFile } from '../io/files.js'
import { paths } from '../io/paths.js'

export const runValidate = async (candidate: boolean): Promise<void> => {
  const manifestPath = candidate
    ? paths.candidateManifest
    : paths.canonicalManifest

  if (!(await fileExists(manifestPath))) {
    throw new Error(`Manifest file not found: ${manifestPath}`)
  }

  const manifest = await readJsonFile<SonyContractManifest>(manifestPath)
  validateManifest(manifest)

  const [sonyConstants, sonyClientText, mapperText, serviceText] =
    await Promise.all([
      readSonyConstants(paths.sonyConstants),
      readProductionRustSources(paths.sonyClientDir),
      readProductionRustFile(paths.mapperFile),
      readProductionRustFile(paths.serviceFile),
    ])

  validateBackendCompatibility(manifest, {
    sonyConstants,
    sonyClientText,
    mapperText,
    serviceText,
  })
}
