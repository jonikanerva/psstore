# Sony GraphQL Contract Runbook

## Scope (Locked)

This tooling always targets the public Finnish storefront with fixed scope:
- region: `fi`
- locale: `fi-fi`
- currency: `EUR`
- platform: `PS5`

No authentication/sign-in workflow is used.

## Refresh contract snapshot

```bash
npm run sony:refresh
```

Pipeline:
1. capture traffic from public fi-fi routes
2. normalize into candidate manifest
3. filter non-PS5 / non-EUR operations
4. validate schema + backend compatibility
5. generate diff report

## Apply candidate as canonical manifest

```bash
npm run sony:normalize -- --write-manifest
npm run sony:validate
```

## CI checks

CI runs:

```bash
npm run sony:validate
npm run sony:diff -- --ci
```

Drift in CI is a hard failure.

## Redaction checklist (pre-commit)

- [ ] No `authorization` header in `docs/contracts/**`
- [ ] No `cookie` header in `docs/contracts/**`
- [ ] No bearer/API tokens in `docs/contracts/**`
- [ ] `.sony-contract/` remains untracked

## Failure handling

- Capture returns zero records: verify storefront reachability.
- Scope filtering removes all records: verify capture really includes fi-fi + PS5 + EUR signals.
- Validation mismatch: update manifest and backend mapping together.
- Drift detected: inspect `docs/contracts/reports/latest-diff.md` and triage operation changes.
