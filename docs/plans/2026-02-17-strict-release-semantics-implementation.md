# Strict Release Semantics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce strict endpoint semantics so `new`, `upcoming`, and `discounted` return only date-valid, policy-compliant games with correct sorting.

**Architecture:** Use one enriched game dataset (concept map + product release-date enrichment) and derive tab outputs via strict predicates and tab-specific sort functions. Remove fallback behavior that injects semantically invalid records into strict tabs.

**Tech Stack:** TypeScript, Express service layer, Sony GraphQL persisted operations, Vitest.

---

### Task 1: Lock strict semantics with failing service tests

**Files:**
- Modify: `server/src/__tests__/gamesService.test.ts`

**Step 1: Write failing tests for `new` strictness**

```ts
it('new includes only released items with valid dates sorted desc', async () => {
  // include past, future, and missing-date records in mocked source
  // assert all returned dates are valid and <= now
  // assert descending order
})
```

**Step 2: Write failing tests for `upcoming` strictness**

```ts
it('upcoming includes only future items with valid dates sorted asc', async () => {
  // assert all returned dates are valid and > now
  // assert ascending order
})
```

**Step 3: Write failing tests for `discounted` strictness**

```ts
it('discounted includes only discounted items with valid dates sorted desc', async () => {
  // assert discounted predicate and valid dates only
  // assert descending order
})
```

**Step 4: Run tests and verify RED**

Run: `npm run test -w server -- gamesService.test.ts`
Expected: FAIL on one or more new strict assertions.

**Step 5: Commit**

```bash
git add server/src/__tests__/gamesService.test.ts
git commit -m "test(server): add strict listing semantics tests for new/upcoming/discounted"
```

### Task 2: Add explicit predicate/sort helpers for strict listing rules

**Files:**
- Modify: `server/src/services/gamesService.ts`

**Step 1: Implement date predicate helpers**

```ts
const toTimestamp = (date: string): number | null => {
  const ts = Date.parse(date)
  return Number.isFinite(ts) ? ts : null
}

const isReleased = (game: Game, now: number): boolean => {
  const ts = toTimestamp(game.date)
  return ts !== null && ts <= now
}

const isUpcoming = (game: Game, now: number): boolean => {
  const ts = toTimestamp(game.date)
  return ts !== null && ts > now
}
```

**Step 2: Add ascending date sort helper**

```ts
const sortByDateAsc = (games: Game[]): Game[] =>
  [...games].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
```

**Step 3: Keep descending helper for `new` and `discounted` only**

**Step 4: Run server tests**

Run: `npm run test -w server -- gamesService.test.ts`
Expected: partial pass or remaining failures before full endpoint wiring.

**Step 5: Commit**

```bash
git add server/src/services/gamesService.ts
git commit -m "refactor(server): add strict date predicate and sort helpers"
```

### Task 3: Enforce strict semantics in `getNewGames`, `getUpcomingGames`, `getDiscountedGames`

**Files:**
- Modify: `server/src/services/gamesService.ts`

**Step 1: Update `getNewGames`**

```ts
const now = Date.now()
const strict = sortByDateDesc(base.filter((game) => isReleased(game, now)))
return strict
```

**Step 2: Update `getUpcomingGames`**

```ts
const now = Date.now()
const candidate = await mapConceptsToGames(await featureConcepts('upcoming'))
const strict = sortByDateAsc(candidate.filter((game) => isUpcoming(game, now)))
return strict
```

**Step 3: Update `getDiscountedGames`**

```ts
const now = Date.now()
const candidate = await mapConceptsToGames(primaryConcepts.filter(isConceptDiscounted))
const strict = sortByDateDesc(candidate.filter((game) => isReleased(game, now)))
return strict
```

**Step 4: Remove fallback mixing for these three endpoints**
- Do not use `ensureNonEmpty` for strict tabs.
- Return empty arrays when no strict matches exist.

**Step 5: Run server tests**

Run: `npm run test -w server`
Expected: PASS for strict semantic tests.

**Step 6: Commit**

```bash
git add server/src/services/gamesService.ts
git commit -m "fix(server): enforce strict tab semantics and sorting rules"
```

### Task 4: Ensure discount semantics remain accurate with enriched dates

**Files:**
- Modify: `server/src/services/gamesService.ts`
- Modify: `server/src/sony/mapper.ts` (only if needed)
- Modify: `server/src/__tests__/mapper.test.ts` (if behavior changed)

**Step 1: Verify discounted predicate source remains concept-pricing based**
- Keep `isConceptDiscounted` as source of truth.

**Step 2: Ensure `discountDate` fallback does not leak invalid dates into strict filtering**
- Strict filter should key off `game.date` validity + release timing.

**Step 3: Run focused tests**

Run:
- `npm run test -w server -- mapper.test.ts`
- `npm run test -w server -- gamesService.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add server/src/services/gamesService.ts server/src/sony/mapper.ts server/src/__tests__/mapper.test.ts
git commit -m "fix(server): align discounted strict filtering with date validity"
```

### Task 5: Add lightweight observability counters for strict filters

**Files:**
- Modify: `server/src/services/gamesService.ts`

**Step 1: Add per-endpoint debug counters**

```ts
console.info(JSON.stringify({
  route: 'new',
  candidates: base.length,
  validDate: validCount,
  excludedMissingDate: missingDateCount,
  result: strict.length,
}))
```

**Step 2: Add analogous logs for `upcoming` and `discounted`**

**Step 3: Run lint/typecheck**

Run:
- `npm run lint -w server`
- `npm run typecheck -w server`

Expected: PASS.

**Step 4: Commit**

```bash
git add server/src/services/gamesService.ts
git commit -m "chore(server): add strict-filter observability counters"
```

### Task 6: Live smoke verification for strict behavior

**Files:**
- No file changes expected

**Step 1: Run server and check endpoint invariants**

Run (example):
```bash
PORT=3012 node server/dist/index.js
```

Then verify:
- `/api/games/new` => all dates valid and <= now, descending.
- `/api/games/upcoming` => all dates valid and > now, ascending.
- `/api/games/discounted` => all dates valid, discounted only, descending.

**Step 2: Capture one sample check command per route**

```bash
curl -sS http://127.0.0.1:3012/api/games/new | jq '...'
```

**Step 3: Commit (only if smoke requires tiny fix)**

```bash
git add <files>
git commit -m "fix(server): finalize strict listing behavior after smoke"
```

### Task 7: Run required repo quality gates

**Files:**
- No expected changes

**Step 1: Run full mandatory gates**

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run sony:validate`
- `npm run sony:diff -- --ci`

Expected: all PASS.

**Step 2: Record command outputs in completion notes**

**Step 3: Final commit (if needed)**

```bash
git add <remaining-files>
git commit -m "chore: finalize strict release-date listing semantics"
```
