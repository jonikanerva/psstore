import { validateBackendCompatibility } from '../compat/backend.js'
import { validateManifest } from '../contract/validator.js'
import type { SonyContractManifest } from '../contract/types.js'
import { fileExists, readJsonFile, readTextFile } from '../io/files.js'
import { paths } from '../io/paths.js'

export const runValidate = async (candidate: boolean): Promise<void> => {
  const manifestPath = candidate ? paths.candidateManifest : paths.canonicalManifest

  if (!(await fileExists(manifestPath))) {
    throw new Error(`Manifest file not found: ${manifestPath}`)
  }

  const manifest = await readJsonFile<SonyContractManifest>(manifestPath)
  validateManifest(manifest)

  const [serverEnvText, sonyClientText, mapperText, serviceText] = await Promise.all([
    readTextFile(paths.envFile),
    readTextFile(paths.sonyClientFile),
    readTextFile(paths.mapperFile),
    readTextFile(paths.serviceFile),
  ])

  validateBackendCompatibility(manifest, {
    serverEnvText,
    sonyClientText,
    mapperText,
    serviceText,
  })
}
