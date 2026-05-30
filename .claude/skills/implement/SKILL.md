---
name: implement
description: >
  Full implement-and-ship workflow. Use when asked to implement a feature,
  fix a bug, or make any code change that should be shipped as a PR.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
argument-hint: <description of what to implement>
---

# Implement and Ship Workflow

Complete workflow for implementing a change and shipping it as a PR. The task description comes from `$ARGUMENTS`.

Communicate in Finnish with the user. All code artifacts (commits, branch names, PR text, code comments) in English per project policy (`CLAUDE.md → Language`).

## Procedure

Follow these steps in order. Do not skip steps.

### Step 1: Run the VISION decision filter

Before writing any code, read `VISION.md → Decision Filter` and answer all four questions verbatim.

If the answer to any question is "no", **stop and surface the conflict in the PR description** (or, if no PR exists yet, on the issue / discussion that proposed the change) — list the proposed change and which decision-filter answer was "no". If the rejection establishes a binding constraint future agents must respect, record it in the PR description and, when it is technical and durable, in `STACK.md → Intentional Divergences`. Then propose the smallest framework-native alternative that passes the filter — that becomes the new task. Do NOT silently violate `VISION.md`.

Also scan `AGENTS.md §13 "Reject changes that…"` and `STACK.md → Stack-specific reject-list additions`. If the task falls into any rejected category, stop, document, and rewrite the task to the smallest acceptable shape.

### Step 2: Ensure feature branch

```
git branch --show-current
```

- If on `main`: create and switch to a feature branch. Derive the branch name from the task: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`. Max 50 characters, lowercase, hyphens only.
- If already on a feature branch: stay on it. Run `git log main..HEAD --oneline` to understand the current state.

**NEVER commit or push to `main` directly.** Hooks and the deny-list will block this, but do not rely on them — use the right branch.

### Step 3.0: Documentation grounding (blocking, per `STACK.md → Documentation protocol`)

Before writing or editing any code that imports a package in the `STACK.md` pinned-version table, query Context7 for that package, version-pinned, with a task-specific question. You **MUST NOT** write library code from memory — Effect priors in particular drift to v2 / v4-beta. For each package touched, record in the PR description: the Context7 ID queried, the question asked, and the API shape it confirmed. **A package seam with no corresponding grounding entry is an incomplete change — `qa-enforcer` will FAIL it.** The riskiest grounding is the glue *between* packages (e.g. wiring an Effect service `Layer` into an HttpApi handler): when a seam spans two packages, ground both sides.

### Step 3: Implement the change

Implement what is described in `$ARGUMENTS`, following all project standards:

- `AGENTS.md §3` + `STACK.md §0` — Architecture. **Functional core, imperative shell**: the pure core MUST NOT import I/O (`fetch`, cache, clock, `@effect/platform`) — dependencies are provided as Effect services via `Layer` (DI is Layer-based; no ad-hoc singletons, no second DI system). No `ViewModel`-per-view boilerplate.
- `AGENTS.md §4` (mapped in `STACK.md §10`) — Concurrency. Structured concurrency via `Effect.gen` / `Effect.all` / scoped fibers; cancellation via Effect interruption + `AbortSignal`; shared non-UI state behind Effect services / `Ref` / `Cache`.
- `STACK.md §0` — **Errors are values**: no `throw` in domain / core logic; failures are tagged errors in the Effect `E` channel; the boundary maps them to HTTP / UI.
- `STACK.md §0`, §11 — **External data untrusted until decoded**: Sony GraphQL is `unknown` until an Effect `Schema` decode narrows it to PS5 / FI / EUR at the boundary. Every decoder gets narrowing + price-mapping tests.
- `AGENTS.md §5` — UI / API responsiveness. Stay inside the budgets declared in `STACK.md`; no expensive work in React render; the event loop stays fluid.
- `AGENTS.md §6` — Side effects. Wrap external systems behind Effect service `Layer`s; `@effect/platform` only inside the one HTTP adapter module; explicit degraded phases.
- `AGENTS.md §7` — Resource budget. Measure bundle size against `STACK.md §4` (TanStack + Tailwind + Effect are not free).
- `AGENTS.md §8` — Privacy. Never log PII; never persist data forbidden by `VISION.md → Persistence and Privacy Posture` or `STACK.md → Persistence shape` (TanStack persister: Sony payloads only).
- `AGENTS.md §10` — Code conventions. No `any` / `as` past a decode; no non-null assertions; no `console.log`; named exports; function components only; hot paths allocation-light.
- Every new feature or behavior change must have tests (`AGENTS.md §9`). Pure core code gets the deepest tests — edge cases; Effect programs use test `Layer`s + `TestClock`.
- Every UI surface that gains new states gets preview / story coverage for each state listed in the screen-local enumeration.

### Step 3.1: Autonomy fallback (no AskUserQuestion)

If the task is unclear or ambiguous:

1. Pick the smallest-surface, most-conservative interpretation that satisfies the `VISION.md` decision filter.
2. Document the choice in the PR description (alternatives considered + rationale). If it introduces a binding constraint for future agents, also record it in `STACK.md → Intentional Divergences` when it is technical and durable.
3. Proceed.

**Do not call `AskUserQuestion`.** The autonomous flow depends on this.

### Step 4: Run verification

```
$VERIFY_CMD
```

The exact command is declared in `STACK.md`. **All must pass.**

If verification fails:

1. Read the error output carefully.
2. Fix the underlying issue — do NOT suppress errors with `as any`, `as unknown as`, `@ts-ignore` / `@ts-expect-error` (without an inline reason naming the constraint), or casting past a `Schema` decode (see `AGENTS.md §4 C13`, `§13`, and `STACK.md §7`). The `no-explicit-any` / `no-unsafe-*` gates are error-level — fix the typing, do not silence it.
3. Re-run `$VERIFY_CMD`.
4. Repeat until all checks pass.
5. **Maximum 10 fix attempts.** If still failing on attempt 11, do not loop indefinitely — create a `chore/abandoned-<task>` branch with the work-in-progress, push it, and describe the failure mode and what was tried in the draft PR (or on the existing PR). The PR / branch on GitHub is the audit trail for the next teammate to pick up. Do **not** call `AskUserQuestion`.

### Step 5: Commit

Stage only the files related to this change. **NEVER** use `git add -A` or `git add .`.

**NEVER** commit `.env` files, credentials, or secrets.

Write commit messages that:

- Follow Conventional Commits: `<type>(<scope>): <summary>`.
- Are concise (1-2 sentences).
- Focus on "why" not "what".
- Are in English.

Each commit must be one complete logical unit. If multiple logical changes were made, create separate commits — one per logical unit.

### Step 6: Push

```
git push -u origin <branch-name>
```

### Step 7: Create or update PR

Check if a PR already exists for this branch:

```
gh pr list --head <branch-name> --json number,url --jq '.[0]'
```

**If no PR exists**, create one using `gh pr create --title "<title>" --body "<body>"`. The body follows `.github/pull_request_template.md`:

- **Closes #\<n\>** — if this task corresponds to a backlog issue, the body opens with `Closes #<n>` so the issue closes automatically on merge. This is the only backlog bookkeeping the workflow requires. Omit only when the task has no backlog issue.
- **Why** — motivation; which `VISION.md` / `AGENTS.md` / `STACK.md` section is at play.
- **What** — brief technical summary of changes.
- **VISION decision filter** — all four questions answered verbatim with a one-line rationale each.
- **AGENTS.md / STACK.md rules** — list the specific sections and sub-rules touched (e.g. `§4 C2, C7`, `§5.1`, `§6.3`).
- **Verification** — `$VERIFY_CMD` passed; any preview / story states added; tests added (incl. Schema-decoder narrowing + price-mapping tests); GDPR data-flow inventory updated if applicable.
- **Context7 grounding** — for every package in `STACK.md → Documentation protocol` the diff touches: the Context7 ID queried, the question, and the confirmed API shape (`qa-enforcer` blocks a missing entry).
- **States handled** — if the change affects UI, list the states handled (loading, success, empty, degraded, permission-blocked, error, plus product-specific).

Keep the title under 70 characters.

**If a PR already exists**, add a comment summarising what changed:

```
gh pr comment <number> --body "<what changed and why>"
```

### Step 8: Report to user

Tell the user in Finnish (the only Finnish artifact — everything written to the repo or GitHub is English):

- Summary of what was implemented.
- Verification results (all passing).
- PR URL.
- Suggest that the user run `/codereview` when ready for review (or note that `/project-manager` will dispatch `qa-enforcer` automatically when driving an issue in `implement` mode).

## Rules

- **NEVER** push to `main`.
- **NEVER** commit secrets, credentials, `.env` files, or values forbidden by `VISION.md → Persistence and Privacy Posture`.
- **NEVER** merge the PR — that happens after review and manual testing (`gh pr merge` is allowed only when the user explicitly asks).
- **NEVER** weaken the strictness mode declared in `STACK.md`, the minimum runtime version, or the language version.
- If `$VERIFY_CMD` does not pass within 10 attempts, do NOT push or create the PR — abandon the branch per Step 4.
- If the VISION decision filter fails, do NOT implement — document, surface, and rewrite the task to the smallest acceptable shape.
- **NEVER** call `AskUserQuestion`.
