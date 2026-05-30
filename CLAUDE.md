@VISION.md
@STACK.md

# CLAUDE.md — operating contract for Claude Code

`VISION.md` is the product; `STACK.md` is the technology and all its concrete rules. This file is the engineering doctrine and team workflow. Where a rule says "as in `STACK.md`", that file is the authority — this file names no language or framework.

Read order: `VISION.md` → this file → `STACK.md` → the issue (`gh issue view <N>`). Treat every rule as MUST unless marked otherwise. When a rule conflicts with a request, surface it — propose the smallest idiomatic alternative, don't silently break it.

## Workflow

The backlog is the GitHub issue list. Drive work through `/project-manager` — the team lead and the only surface that talks to the user; invoke it by issue number (`solve issue #42`) or a problem description.

- `/project-manager` — reads the issue, proposes a plan, then convenes the team (`architect`, `ux-guardian`, `devils-advocate`, `lead-dev`, `qa-enforcer`). They design, stress-test, implement, open a PR, and run `/codereview` to PASS. The PR reaches the user only after PASS, for the final review.
- `/implement <task>` — branch → change → `$VERIFY_CMD` → commit → push → PR. `lead-dev` runs it once per issue.
- `/codereview` — reviews the branch against `main`, posts a PASS/FAIL comment. `qa-enforcer` runs it after each `/implement`.

## Audit trail

The record of what and why is: issues (problem + scope clarifications + decision-filter outcomes), commits (Conventional, one logical unit, "why" in the message), PR descriptions and review comments, and the merge-commit chain on `main`. There is no roadmap or change-log file; do not create one. A decision that binds future work is stated in plain language in the PR and the issue.

## Language

Everything in the repo or on GitHub is in English (code, comments, commits, branches, PRs, issues, docs). Only Claude's chat replies to the user are in Finnish.

## Git workflow

- Use `/implement`; never commit or push to `main`. Branches: `feat|fix|chore|docs/<topic>` (≤50 chars, lowercase, hyphens).
- Conventional Commits; each agent-authored commit ends with `Co-Authored-By: <agent display name> <noreply@anthropic.com>`.
- **Merge to `main` with a merge commit — never squash** (enforced in repo settings). Delete the branch after merge.
- Link the issue with `Closes #<N>`. Every PR description covers why, what, the rules at play, and the decision-filter outcome.
- **Trivial PRs** (typo, dep bump, dead-code/formatting; no behavioural change) may collapse the decision-filter / states / rules blocks to `N/A — trivial change`. Why / what / verification stay mandatory; if any rule applies, the exception is void.

## Verification

Run `$VERIFY_CMD` (from `STACK.md`) before every commit and PR; it must pass with no new warnings, and CI runs it as the PR gate. Always go through the named commands (`$FORMAT_CMD`, `$LINT_CMD`, `$BUILD_CMD`, `$TEST_CMD`, `$VERIFY_CMD`); never invoke the underlying tools directly.

---

# Engineering doctrine

Concrete technology, budgets, and banned calls live in `STACK.md`.

## Mission

Build the product in `VISION.md` on the stack in `STACK.md`: idiomatic (platform standard library and first-party frameworks first; prefer newer platform features over older ones); responsive under failure and load; strictly typed and concurrency-safe in the strictest mode `STACK.md` allows, no new warnings, no data races; resource-conscious within the budgets in `STACK.md`; privacy-respecting (collect only what's needed; no silent telemetry or third-party analytics); easy to evolve (no custom app frameworks, no architecture astronautics).

## Product guardrails

Before accepting any feature, run `VISION.md → Decision Filter`. If any answer is "no", reject it, record the rejection in the PR (or the issue if no PR yet), and propose the smallest alternative that passes. Read the filter dynamically; never silently violate `VISION.md`.

## Architecture

Keep a layered shape (named per `STACK.md`): **interface** (the outward surface — screens, request handlers, CLI commands, public API), **domain** (pure transforms, state machines, business rules; no framework imports), **infrastructure** (network, storage, sensors, external systems, reached only through narrow interfaces). Domain code is pure and testable.

Right-size state ownership — no controller / service per trivial unit:

- local state → a primitive owned by that surface;
- shared stateful surface → one state owner;
- shared mutable non-UI state → a thread-safe primitive;
- app-wide dependency → explicit injection;
- durable data → the persistence layer in `STACK.md`.

Name owners by responsibility, not mechanical suffix. Model phases as tagged unions, not parallel booleans.

## Concurrency

Strictest async-safety mode in `STACK.md`, no new warnings. Isolate critical-path state explicitly. Shared mutable non-UI state lives behind a thread-safe primitive; services expose async methods or streams. Prefer structured concurrency; use detached work only when it must outlive its caller, with a why comment. **Cancellation is mandatory** — work stops when its surface goes away. Types crossing concurrency boundaries are thread-safe; never pass mutable reference graphs across them. The critical path never blocks on async work. Escape hatches are a last resort, each needing an inline justification naming the underlying-API constraint; `STACK.md` lists the banned ones.

## Responsiveness & resource budget

On the critical execution path (whatever `STACK.md` declares — UI thread, event loop, request hot path): keep synchronous work within the budget; run anything slower off-path with a placeholder, last-known-good value, stream, or pagination; give every external call a timeout and graceful fallback; render large collections lazily with stable ids; load assets via async loader or thread-safe cache; do no expensive work in code that runs on every event — cache derived results; never make navigation or input wait on I/O. Prefer continuity over blankness. Profile hot-path changes with the tooling in `STACK.md`. Pause background work when the surface is inactive.

## States handled

Every visible surface handles the states `VISION.md` and `STACK.md` declare — commonly awaiting-first-data, success, empty, degraded, permission-blocked, offline, error, plus product-specific. Previews / stories / fixtures exercise each applicable state.

## Side effects

- **External systems / networking** — through the client in `STACK.md`; request building, decoding, retries, backoff live in the service layer, never inline in the interface. Wrap every side-effecting system behind a service with explicit degraded phases; start work when needed, stop when not; request the narrowest permission scope.
- **Persistence** — only the shape in `STACK.md`; never persist data the product doesn't require; handle decode/migration failures gracefully.
- **Caching** — framework-native where available; long-lived caches behind a thread-safe primitive; never cache PII or tokens beyond their lifetime.
- **Background work** — only what `STACK.md` allows.

## Privacy & security

Maintain the platform's privacy declaration accurately. Never log PII or sensitive derived values — use the platform's redaction (per `STACK.md`); release builds must not leak. No silent telemetry or third-party analytics. Encrypted transport only. Secrets stay out of the repo (environment / ignored files).

## Testing

Use the framework in `STACK.md`; tests run clean in the strictest mode. Test pure domain code first (transforms, transitions, edge cases). Test the state owner that drives a surface, not the surface, using a fake/in-memory service boundary and asserting the timeline. Prefer interface-backed services with live/preview/fake implementations over heavyweight mocking.

## Code conventions

Value types and immutable bindings by default; reference types/mutation only when identity or shared mutation is needed. Composition over inheritance; small purpose-driven types; files named for their primary type. No unsafe unwraps/coercions outside tests; no broad type erasure without a measured benefit; no global mutable state or singletons unless an API requires one. Delete dead code; comments explain why, not the obvious; exported symbols get a doc comment. No debug output in shipped code — use the logger in `STACK.md`, which names the banned calls. Run `$FORMAT_CMD` before committing.

## Dependencies

Default to no — especially for what the platform already solves. A genuinely needed one uses the package manager in `STACK.md`, compiles clean in the strictest mode, and is added to `STACK.md → Approved Dependencies` with rationale, approver, and date.

## Reject changes that…

violate a decision-filter question or add a `VISION.md → Non-Goals` feature; add a competing framework or boilerplate where a smaller owner suffices; put heavy work on the critical path or in per-event code; couple the interface layer to network/storage/sensor internals; hide failure behind infinite spinners or use parallel booleans for a state machine; suppress warnings with escape hatches; spawn fire-and-forget async with no ownership or cancellation; add a dependency for what the platform solves or lower the minimum version in `STACK.md`; introduce debug output, stubs, or commented-out code, or log PII; add singletons/DI containers without `STACK.md` approval; or break any `STACK.md → Stack-specific reject-list additions` rule.

## Definition of done

Responsive under slow network / denied permissions / degraded data / load; every applicable state handled; no heavy work on the critical path; every async path cancellation-safe; no new persisted/transmitted data violating `VISION.md` or `STACK.md`, no PII in logs; tests cover new domain logic and run clean in the strictest mode; accessibility considered for user-facing surfaces; `$VERIFY_CMD` green; privacy declarations and docs updated when relevant.

## Autonomy fallback

When a decision is ambiguous and not derivable from `VISION.md`, `STACK.md`, this file, or the issue: pick the smallest-surface, most-conservative interpretation that passes the decision filter, document it in the PR (and the issue if it binds future work), and proceed. **Do not call `AskUserQuestion`** — the only exception is direct edits to `VISION.md` or this file, which need an explicit user request. If `$VERIFY_CMD` keeps failing after 10 attempts, stop: push a `chore/abandoned-<task>` branch, open a draft PR (or comment on the PR and issue) describing the failure, and leave it for a human.

## Intentional divergence

Valid but deliberate: measurable need, clear benefit, isolated exception, documented reason. Record it in `STACK.md → Intentional Divergences`. Divergence from `VISION.md` needs the product owner.

---

## Safeguards

Enforced in `.claude/settings.json`: force-push and pushes to `main` are blocked; `rm -rf` is deny-listed; `gh pr merge` only runs when the user explicitly asks, never on the agent's initiative.

## Decision rights

- **Auto-allow**: read-only commands, the `STACK.md` build/test/lint commands, feature-branch ops (create, commit, push origin `<branch>`), PR creation, `gh pr view`/`comment`/`diff`/`review`, `gh issue view`/`list`/`comment`, `STACK.md` edits.
- **Ask first**: edits to `VISION.md` or `CLAUDE.md`, creating/restructuring issues, `gh api` calls changing repo settings. `gh pr merge` only when explicitly asked.
- **Never**: force push, push to `main`, bypass hooks (`--no-verify`), `rm -rf` in the project, or persist/transmit data forbidden by `VISION.md → Persistence and Privacy Posture`.
