import path from 'node:path'

export const repoRoot = process.cwd()

export const paths = {
  rawCapture: path.join(repoRoot, '.sony-contract', 'raw', 'latest.ndjson'),
  candidateManifest: path.join(
    repoRoot,
    '.sony-contract',
    'normalized',
    'sony-graphql-manifest.candidate.json',
  ),
  canonicalManifest: path.join(repoRoot, 'docs', 'contracts', 'sony-graphql-manifest.json'),
  diffReport: path.join(repoRoot, 'docs', 'contracts', 'reports', 'latest-diff.md'),
  runbook: path.join(repoRoot, 'docs', 'contracts', 'sony-graphql-runbook.md'),
  envFile: path.join(repoRoot, 'server', 'src', 'config', 'env.ts'),
  sonyClientFile: path.join(repoRoot, 'server', 'src', 'sony', 'sonyClient.ts'),
  mapperFile: path.join(repoRoot, 'server', 'src', 'sony', 'mapper.ts'),
  serviceFile: path.join(repoRoot, 'server', 'src', 'services', 'gamesService.ts'),
}
