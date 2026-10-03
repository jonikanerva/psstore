import { describe, expect, it } from 'vitest'
import type { ManifestDiff } from '../contract/diff.js'
import { renderDiffReport } from '../contract/report.js'
import type { ContractOperation } from '../contract/types.js'

const noDrift: ManifestDiff = {
  hasDrift: false,
  added: [],
  removed: [],
  changed: [],
}

const operation: ContractOperation = {
  feature: 'new',
  operation_name: 'categoryGridRetrieve',
  persisted_query_hash: 'newhash',
  required_headers: ['x-apollo-operation-name'],
  variables_schema: {},
  sample_variables: {},
  response_path: 'data.categoryGridRetrieve.products',
  observed_status_codes: [200],
}

const withDrift: ManifestDiff = {
  hasDrift: true,
  added: [],
  removed: [],
  changed: [
    {
      from: { ...operation, persisted_query_hash: 'oldhash' },
      to: operation,
    },
  ],
}

const headline = (report: string): string =>
  report.split('\n').find((line) => line.startsWith('- Drift detected:')) ?? ''

describe('renderDiffReport tri-state headline', () => {
  it('reads UNKNOWN when no candidate was compared (no fresh capture)', () => {
    // The regression guard: with no candidate the diff falls back to
    // canonical-vs-canonical (hasDrift === false), but the headline must NOT
    // read "no": that would be a false green.
    const line = headline(renderDiffReport(noDrift, false))
    expect(line).toBe(
      '- Drift detected: UNKNOWN (no fresh capture — not checked against live Sony)',
    )
    expect(line).not.toBe('- Drift detected: no')
  })

  it('still reads UNKNOWN even if a fallback diff somehow reports drift', () => {
    // hasCandidate is the sole driver of the UNKNOWN headline; hasDrift cannot
    // override it to yes/no when nothing fresh was compared.
    expect(headline(renderDiffReport(withDrift, false))).toBe(
      '- Drift detected: UNKNOWN (no fresh capture — not checked against live Sony)',
    )
  })

  it('reads "no" when a candidate is present and there is no drift', () => {
    expect(headline(renderDiffReport(noDrift, true))).toBe(
      '- Drift detected: no',
    )
  })

  it('reads "yes" when a candidate is present and there is drift', () => {
    expect(headline(renderDiffReport(withDrift, true))).toBe(
      '- Drift detected: yes',
    )
  })

  it('still renders the Added/Removed/Changed counts and impacted routes', () => {
    const report = renderDiffReport(withDrift, true)
    expect(report).toContain('- Changed: 1')
    expect(report).toContain('## Changed')
    expect(report).toContain('oldhash -> newhash')
    expect(report).toContain('## Impacted API Routes')
  })

  it('lists the purchased route among the impacted routes', () => {
    const lines = renderDiffReport(noDrift, true).split('\n')
    const search = lines.indexOf('- /api/games/search')
    expect(lines[search + 1]).toBe('- /api/games/purchased')
    expect(lines[search + 2]).toBe('- /api/games/wishlist')
    expect(lines[search + 3]).toBe('- /api/games/:id')
  })

  it('says unobserved when the wishlist entry has no observed status', () => {
    const wishlist: ContractOperation = {
      ...operation,
      feature: 'wishlist',
      observed_status_codes: [],
    }
    const report = renderDiffReport(noDrift, true, [wishlist])
    expect(report).toContain('- wishlist: unobserved (owner probe pending)')
  })

  it('says unobserved when the purchased entry has no observed status', () => {
    const purchased: ContractOperation = {
      ...operation,
      feature: 'purchased',
      observed_status_codes: [],
    }
    const report = renderDiffReport(noDrift, true, [purchased])
    expect(report).toContain('- purchased: unobserved (owner probe pending)')
  })

  it('shows the observed status once the owner probe recorded it', () => {
    const purchased: ContractOperation = {
      ...operation,
      feature: 'purchased',
      observed_status_codes: [200],
    }
    const report = renderDiffReport(noDrift, true, [purchased])
    expect(report).toContain('- purchased: observed 200')
    expect(report).not.toContain('unobserved')
  })
})
