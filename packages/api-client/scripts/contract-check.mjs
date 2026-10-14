// Checks that the committed contract and the committed client match the
// routes. The check exports the OpenAPI document from the Rust routes into a
// scratch directory, generates the client from that export into the same
// scratch directory, and compares both complete trees with the committed
// trees: `contract/` and `packages/api-client/src/generated/`. An added, a
// deleted, or a changed file is drift. The check never writes the working
// tree; it removes its scratch directory at the end.
//
// The exit code is 0 without drift and 1 on drift or on a failed step.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
import { URL, fileURLToPath } from 'node:url'
import { createClient } from '@hey-api/openapi-ts'
import { generatorConfig } from './generator-config.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))

// Every file below `dir`, as paths relative to `dir` with `/` separators.
const listFiles = (dir) => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'),
    )
    .sort()
}

// The differences between the committed tree and the expected tree.
const compareTrees = (label, committed, expected) => {
  const committedFiles = new Set(listFiles(committed))
  const expectedFiles = new Set(listFiles(expected))
  const drift = []
  for (const file of expectedFiles) {
    if (!committedFiles.has(file)) {
      drift.push(`${label}/${file}: missing from the committed tree`)
    } else if (
      !readFileSync(join(committed, file)).equals(
        readFileSync(join(expected, file)),
      )
    ) {
      drift.push(`${label}/${file}: differs from the regenerated file`)
    }
  }
  for (const file of committedFiles) {
    if (!expectedFiles.has(file)) {
      drift.push(`${label}/${file}: not produced by the generator`)
    }
  }
  return drift
}

const scratch = mkdtempSync(join(tmpdir(), 'psstore-contract-check-'))
try {
  const contract = join(scratch, 'contract')
  const generated = join(scratch, 'generated')
  mkdirSync(contract)
  execFileSync(
    'cargo',
    [
      'run',
      '--locked',
      '--quiet',
      '-p',
      'psstore-server',
      '--bin',
      'openapi',
      '--',
      join(contract, 'openapi.json'),
    ],
    { cwd: root, stdio: 'inherit' },
  )
  await createClient({
    ...generatorConfig({
      input: join(contract, 'openapi.json'),
      output: generated,
    }),
    logs: { level: 'silent' },
  })
  const drift = [
    ...compareTrees('contract', join(root, 'contract'), contract),
    ...compareTrees(
      'packages/api-client/src/generated',
      join(root, 'packages/api-client/src/generated'),
      generated,
    ),
  ]
  if (drift.length > 0) {
    process.stderr.write(
      [
        'contract-check: the committed contract or client is out of date.',
        ...drift.map((line) => `  ${line}`),
        'Run `cargo run --locked -p psstore-server --bin openapi -- contract/openapi.json`',
        'and `pnpm --filter @psstore/api-client run generate`, then commit both.',
        '',
      ].join('\n'),
    )
    process.exitCode = 1
  } else {
    process.stdout.write(
      'contract-check: contract/ and the generated client match the routes.\n',
    )
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
