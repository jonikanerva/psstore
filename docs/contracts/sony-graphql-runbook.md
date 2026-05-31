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
pnpm run sony:refresh
```

Pipeline:

1. capture traffic from public fi-fi routes
2. normalize into candidate manifest
3. filter non-PS5 / non-EUR operations
4. validate schema + backend compatibility
5. generate diff report

## Apply candidate as canonical manifest

```bash
pnpm run sony:normalize -- --write-manifest
pnpm run sony:validate
```

## Refresh cadence

Run a live capture **weekly** and review the result:

```bash
pnpm run sony:refresh
# then read the headline of:
docs/contracts/reports/latest-diff.md
```

On drift, follow the **Failure handling** entries below (re-capture, then commit
the updated `server/src/config/env.ts` hash constants together with the
refreshed `docs/contracts/sony-graphql-manifest.json`).

**Why this is manual and weekly:** the `pnpm test-all` gate runs
`sony:diff -- --ci`, but in CI there is no candidate capture (`.sony-contract/`
is gitignored and CI never runs `sony:capture`), so that gate only compares the
canonical manifest **against itself** — it cannot detect live Sony drift. Its
report headline reads `Drift detected: UNKNOWN (no fresh capture …)` precisely
so a green CI run is never misread as "verified against live Sony". The weekly
manual `sony:refresh` is therefore the **actual live-drift detector**.

Do **not** automate this with a cron job or a GitHub Action — scheduled jobs are
out of scope (STACK.md §10). The cadence is a deliberate human step.

## CI checks

CI runs:

```bash
pnpm run sony:validate
pnpm run sony:diff -- --ci
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
- **PersistedQueryNotFound / `UpstreamQueryRotated` (HTTP 502):** Sony shipped a new store build and the persisted-query hash rotated (Sony answers HTTP 200 + a top-level GraphQL `errors[]`; the backend classifies it as `UpstreamQueryRotated`). The hash is stale. Re-capture via `pnpm sony:refresh`, then commit the updated `server/src/config/env.ts` hash constants together with the refreshed `docs/contracts/sony-graphql-manifest.json`.
- **`UpstreamRateLimited` (HTTP 503):** Sony answered HTTP 429 and the single bounded retry did not clear it. Transient; no manifest action. The backend honours a clamped `Retry-After` (capped at the request timeout budget) — no token bucket is added (STACK.md §5 budget is TBD).
