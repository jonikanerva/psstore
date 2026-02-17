# Strict Release-Date Semantics Design (New/Upcoming/Discounted)

## Summary
Define strict, deterministic listing behavior for `new`, `upcoming`, and `discounted` tabs so each route reflects release-date truth and discount truth.

Approved policy:
- Unknown/missing release dates are excluded from all three tabs.
- `new`: already released only, sorted newest first.
- `upcoming`: future releases only, sorted soonest first.
- `discounted`: discounted only with valid release date, sorted newest first.

## Problem
Current behavior can violate product semantics because fallback logic and weak temporal filtering can mix categories and include records without authoritative release date resolution.

## Goals
- Enforce strict route semantics.
- Ensure sorting is correct for each tab.
- Eliminate date-unknown records from these three tabs.
- Keep data contract stable for the frontend.

## Non-Goals
- Change `plus` semantics.
- Redesign UI.
- Add pagination contract.

## Decision: Recommended Approach
Selected: **Strict post-filtering on enriched base feed**.

Rationale:
- Single normalized pipeline.
- Lowest complexity and drift risk.
- Strongest testability and determinism.

## Behavior Contract

### `GET /api/games/new`
- Include only games with valid release date where `releaseDate <= now`.
- Sort by release date descending.

### `GET /api/games/upcoming`
- Include only games with valid release date where `releaseDate > now`.
- Sort by release date ascending.

### `GET /api/games/discounted`
- Include only games with valid release date and discount applied.
- Sort by release date descending.

### Missing/Invalid Date
- Exclude from all three tabs.

### Empty Results
- Return an empty array (strict behavior over fallback contamination).

## Architecture and Data Flow
1. Fetch candidate concept lists (existing strategy layer).
2. Map concept -> game (cover image prioritized by role, `MASTER` first).
3. Enrich release date via product metadata operation (`metGetProductById`).
4. Validate release date parseability.
5. Derive tab outputs from enriched pool using strict predicates.
6. Apply tab-specific sort function.

### Date Utilities
- `hasValidDate(game)` => strict parse check.
- `isReleased(game, now)` => valid date and `<= now`.
- `isUpcoming(game, now)` => valid date and `> now`.

### Sort Utilities
- `sortByDateDesc` for `new` and `discounted`.
- `sortByDateAsc` for `upcoming`.

## Fallback Policy Change
For `new/upcoming/discounted` only:
- Remove broad fallback that injects non-compliant records.
- Keep strict filtering even if list shrinks.

## Testing Plan

### Unit/Service Tests
- `new` excludes future and unknown-date items; descending order.
- `upcoming` includes only future dated items; ascending order.
- `discounted` includes only discounted + valid-date items; descending order.
- Unknown-date records never appear in these tabs.
- Regression case where enriched release date places title into correct tab.

### Integration Expectations
- Route responses contain only policy-compliant items.
- Empty arrays are allowed when no compliant records exist.

## Observability
Per request, log counters:
- candidates fetched
- release dates enriched successfully
- excluded for missing/invalid date
- final result count

## Risks and Mitigations
- Risk: smaller result sets when enrichment coverage drops.
  - Mitigation: explicit observability + future phase for deeper page scan/retry strategy.
- Risk: timezone confusion around boundary dates.
  - Mitigation: compare UTC timestamps consistently and test boundary cases.

## Acceptance Criteria
1. `new` never includes future or unknown-date items.
2. `upcoming` never includes past/unknown-date items.
3. `discounted` never includes non-discounted/unknown-date items.
4. Sorting rules hold on every endpoint response.
5. Full quality gates pass.
