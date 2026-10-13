import path from 'node:path'

export const repoRoot = process.cwd()

// The Rust crate roots, relative to the repository root. The compatibility
// check reads the Sony client and the games service in the server crate, and
// the mapper in the domain crate.
export const SERVER_CRATE_DIR = path.join('crates', 'server')
export const DOMAIN_CRATE_DIR = path.join('crates', 'domain')

// The files of the bot under one repository root. The tests use another root.
export const pathsFor = (root: string) => {
  const serverSource = path.join(root, SERVER_CRATE_DIR, 'src')
  const domainSource = path.join(root, DOMAIN_CRATE_DIR, 'src')
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
    mapperFile: path.join(domainSource, 'mapper.rs'),
    serviceFile: path.join(serverSource, 'application', 'games.rs'),
  }
}

export const paths = pathsFor(repoRoot)
