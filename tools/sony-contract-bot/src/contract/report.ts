import type { ManifestDiff } from './diff.js'

// Tri-state headline. The line a reviewer greps must NOT read "no" when nothing
// was compared against a fresh capture: with no candidate manifest the diff
// falls back to canonical-vs-canonical (always "no drift"), which would be a
// false green. When `hasCandidate` is false we say UNKNOWN instead. `hasDrift`
// itself stays a boolean (the `--ci` throw consumes it), so a clean checkout
// with no candidate still exits 0 — see commands/diff.ts.
export const renderDiffReport = (
  diff: ManifestDiff,
  hasCandidate: boolean,
): string => {
  const lines: string[] = ['# Sony GraphQL Contract Drift Report', '']

  const headline = hasCandidate
    ? diff.hasDrift
      ? 'yes'
      : 'no'
    : 'UNKNOWN (no fresh capture — not checked against live Sony)'
  lines.push(`- Drift detected: ${headline}`)
  lines.push(`- Added: ${String(diff.added.length)}`)
  lines.push(`- Removed: ${String(diff.removed.length)}`)
  lines.push(`- Changed: ${String(diff.changed.length)}`)
  lines.push('')

  if (diff.added.length > 0) {
    lines.push('## Added')
    for (const operation of diff.added) {
      lines.push(
        `- ${operation.feature}: ${operation.operation_name} (${operation.persisted_query_hash ?? 'no-hash'})`,
      )
    }
    lines.push('')
  }

  if (diff.removed.length > 0) {
    lines.push('## Removed')
    for (const operation of diff.removed) {
      lines.push(
        `- ${operation.feature}: ${operation.operation_name} (${operation.persisted_query_hash ?? 'no-hash'})`,
      )
    }
    lines.push('')
  }

  if (diff.changed.length > 0) {
    lines.push('## Changed')
    for (const operation of diff.changed) {
      lines.push(
        `- ${operation.from.feature}: ${operation.from.operation_name} (${operation.from.persisted_query_hash ?? 'no-hash'} -> ${operation.to.persisted_query_hash ?? 'no-hash'})`,
      )
    }
    lines.push('')
  }

  lines.push('## Impacted API Routes')
  lines.push('- /api/games/new')
  lines.push('- /api/games/upcoming')
  lines.push('- /api/games/discounted')
  lines.push('- /api/games/:id')
  lines.push('')

  return `${lines.join('\n')}\n`
}
