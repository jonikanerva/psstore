import path from 'node:path'

export const repoRoot = process.cwd()

// The server crate root, relative to the repository root. The compatibility
// check reads the Sony client, the mapper, and the games service there.
export const SERVER_CRATE_DIR = 'server'

// The files of the bot under one repository root. The tests use another root.
export const pathsFor = (root: string) => {
  const serverSource = path.join(root, SERVER_CRATE_DIR, 'src')
  return {
    rawCapture: path.join(root, '.sony-contract', 'raw', 'latest.ndjson'),
    candidateManifest: path.join(
      root,
      '.sony-contract',
      'normalized',
      'sony-graphql-manifest.candidate.json',
    ),
    canonicalManifest: path.join(
      root,
      'docs',
      'contracts',
      'sony-graphql-manifest.json',
    ),
    diffReport: path.join(
      root,
      'docs',
      'contracts',
      'reports',
      'latest-diff.md',
    ),
    runbook: path.join(root, 'docs', 'contracts', 'sony-graphql-runbook.md'),
    // The fixed Sony contract values. The server compiles the same file in.
    sonyConstants: path.join(root, 'docs', 'contracts', 'sony-constants.json'),
    sonyClientDir: path.join(serverSource, 'sources', 'sony'),
    mapperFile: path.join(serverSource, 'domain', 'mapper.rs'),
    serviceFile: path.join(serverSource, 'application', 'games.rs'),
  }
}

export const paths = pathsFor(repoRoot)
