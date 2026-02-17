import type { ManifestDiff } from './diff.js'

export const renderDiffReport = (diff: ManifestDiff): string => {
  const lines: string[] = ['# Sony GraphQL Contract Drift Report', '']

  lines.push(`- Drift detected: ${diff.hasDrift ? 'yes' : 'no'}`)
  lines.push(`- Added: ${diff.added.length}`)
  lines.push(`- Removed: ${diff.removed.length}`)
  lines.push(`- Changed: ${diff.changed.length}`)
  lines.push('')

  if (diff.added.length > 0) {
    lines.push('## Added')
    for (const operation of diff.added) {
      lines.push(`- ${operation.feature}: ${operation.operation_name} (${operation.persisted_query_hash ?? 'no-hash'})`)
    }
    lines.push('')
  }

  if (diff.removed.length > 0) {
    lines.push('## Removed')
    for (const operation of diff.removed) {
      lines.push(`- ${operation.feature}: ${operation.operation_name} (${operation.persisted_query_hash ?? 'no-hash'})`)
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
  lines.push('- /api/games/plus')
  lines.push('- /api/games/search')
  lines.push('- /api/games/:id')
  lines.push('')

  return `${lines.join('\n')}\n`
}
