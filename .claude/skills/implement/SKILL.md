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

If the answer to any question is "no", **stop and surface the conflict in the PR description** (or, if no PR exists yet, on the issue that proposed the change) — list the proposed change and which decision-filter answer was "no". If the rejection establishes a binding constraint future agents must respect, also state it in the relevant issue. Then propose the smallest framework-native alternative that passes the filter — that becomes the new task. Do NOT silently violate `VISION.md`.

Also scan `CLAUDE.md → Reject changes that…` and `STACK.md → Stack-specific reject-list additions`. If the task falls into any rejected category, stop, document, and rewrite the task to the smallest acceptable shape.

### Step 2: Ensure feature branch

```
git branch --show-current
```

- If on `main`: create and switch to a feature branch. Derive the branch name from the task: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`. Max 50 characters, lowercase, hyphens only.
- If already on a feature branch: stay on it. Run `git log main..HEAD --oneline` to understand the current state.

**NEVER commit or push to `main` directly.** Hooks and the deny-list will block this, but do not rely on them — use the right branch.

### Step 3: Implement the change

Implement what is described in `$ARGUMENTS`, following the engineering doctrine in `CLAUDE.md` and the concrete rules in `STACK.md`. In particular:

- **Architecture** — keep the layered shape; right-size state ownership (no controller / service per trivial surface); model phases as tagged unions, not parallel booleans.
- **Concurrency** — the strictest mode `STACK.md` declares; isolate critical-path state; thread-safe primitives for shared mutable non-UI state; structured, cancellation-aware async.
- **Responsiveness & resources** — stay inside the budgets in `STACK.md`; no heavy work on the critical execution path or in code that runs on every event.
- **Side effects** — wrap external systems behind services with explicit degraded phases.
- **Privacy** — never log PII; never persist data forbidden by `VISION.md → Persistence and Privacy Posture` or `STACK.md`.
- **Code conventions** — value types and immutable bindings by default; no unsafe unwraps; no debug output; no global mutable state; hot paths allocation-light. `STACK.md` names the specific banned calls.
- **Tests** — every new feature or behavior change has tests; pure domain code gets the deepest, edge-case coverage.
- Every surface that gains new states gets preview / story / fixture coverage for each applicable declared state.

### Step 3.1: Autonomy fallback (no AskUserQuestion)

If the task is unclear or ambiguous:

1. Pick the smallest-surface, most-conservative interpretation that satisfies the `VISION.md` decision filter.
2. Document the choice in the PR description (alternatives considered + rationale). If it introduces a binding constraint for future agents, also state it in the relevant issue.
3. Proceed.

**Do not call `AskUserQuestion`.** The autonomous flow depends on this.

### Step 4: Run verification

```
$VERIFY_CMD
```

The exact command is declared in `STACK.md`. **All must pass.**

If verification fails:

1. Read the error output carefully.
2. Fix the underlying issue — do NOT suppress warnings with concurrency / type-check escape hatches (`STACK.md → Stack-specific reject-list additions` names the ones banned for this stack; the doctrine forbids them generally).
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

**If no PR exists**, create one using `gh pr create --title "<title>" --body "<body>"`. When the change resolves a GitHub issue, include `Closes #<N>` in the body so merging closes the issue and the issue thread carries the outcome. The body must follow `.github/pull_request_template.md`:

- **Why** — motivation; which `VISION.md` / `CLAUDE.md` / `STACK.md` rule is at play.
- **What** — brief technical summary of changes.
- **VISION decision filter** — all four questions answered verbatim with a one-line rationale each.
- **Rules involved** — name the doctrine and `STACK.md` rules touched (e.g. "concurrency: cancellation", "responsiveness budget", "side effects: service boundary").
- **Verification** — `$VERIFY_CMD` passed; any preview / story states added; tests added; privacy declaration updated if applicable.
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
- Suggest that the user run `/codereview` when ready for review (or note that `/project-manager` dispatches `qa-enforcer` automatically — the PR is surfaced to the user only after the team's `/codereview` is PASS).

## Rules

- **NEVER** push to `main`.
- **NEVER** commit secrets, credentials, `.env` files, or values forbidden by `VISION.md → Persistence and Privacy Posture`.
- **NEVER** merge the PR — that happens after review and manual testing (`gh pr merge` is allowed only when the user explicitly asks).
- **NEVER** weaken the strictness mode declared in `STACK.md`, the minimum runtime version, or the language version.
- If `$VERIFY_CMD` does not pass within 10 attempts, do NOT push or create the PR — abandon the branch per Step 4.
- If the VISION decision filter fails, do NOT implement — document, surface, and rewrite the task to the smallest acceptable shape.
- **NEVER** call `AskUserQuestion`.
