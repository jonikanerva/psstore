@VISION.md
@STACK.md

# CLAUDE.md — operating contract for Claude Code

`VISION.md` is the product; `STACK.md` is the technology and all its concrete rules. This file is the engineering doctrine and team workflow. Where a rule says "as in `STACK.md`", that file is the authority — this file names no language or framework.

Read order: `VISION.md` → this file → `STACK.md` → the issue (`gh issue view <N>`). Treat every rule as MUST unless marked otherwise. When a rule conflicts with a request, surface it — propose the smallest idiomatic alternative, don't silently break it.

## Workflow

The backlog is the GitHub issue list. Drive work through `/project-manager` — the team lead and the only surface that talks to the user; invoke it by issue number (`solve issue #42`) or a problem description.

- `/project-manager` — reads the issue, proposes a plan, then convenes the team (`architect`, `ux-guardian`, `devils-advocate`, `lead-dev`, `qa-enforcer`). They design, stress-test, implement, open a PR, and run `/codereview` to PASS. The PR reaches the user only after PASS, for the final review.
- `/implement <task>` — branch → change → lint and build → commit → `$VERIFY_CMD` → push → PR. `lead-dev` runs it once per issue.
- `/codereview` — reviews the branch against `main`, posts a PASS/FAIL comment. Only `qa-enforcer` runs it (once after each `/implement`); `lead-dev` hands the PR off rather than reviewing its own work.

## Audit trail

The record of what and why is: issues (problem + scope clarifications + decision-filter outcomes), commits (Conventional, one logical unit, "why" in the message), PR descriptions and review comments, and the merge-commit chain on `main`. There is no roadmap or change-log file; do not create one. A decision that binds future work is stated in plain language in the PR and the issue.

Deferred work must not die in a PR comment or a conversation note: when planning or review defers an item out of the current scope, file it as a GitHub issue labelled `follow-up` (surface them with `gh issue list --label follow-up`). Agents file issues unprompted only for this and for a tracking/decision issue preserving a binding decision that no existing issue or PR can carry; the user still owns the backlog and may close or rescope them freely.

## Language

Everything in the repo or on GitHub is in English (code, comments, commits, branches, PRs, issues, docs). Only Claude's chat replies to the user are in Finnish.

Use Simplified Technical English (STE) for English text that users read in the repository or on GitHub. This includes documentation, code comments, commit messages, issues, PR descriptions, and review comments. Identifiers, framework names, and API terms stay verbatim — STE governs the prose around them, never the names themselves. Write short sentences. Use active voice and plain, consistent terms. This rule does not apply to Finnish chat. Do not rewrite compact operating contracts only to apply STE.

## Git workflow

- Use `/implement`; never commit or push to `main`. Branches: `feat|fix|chore|docs/<topic>` (≤50 chars, lowercase, hyphens).
- **No push to `main` — neither a normal push nor a force-push.** On a feature branch a force-push is allowed. Use `--force-with-lease`, never a bare `--force`.
- Conventional Commits; each agent-authored commit ends with `Co-Authored-By: <agent display name> <noreply@anthropic.com>`.
- **Merge to `main` with a merge commit — never squash** (enforced in repo settings). Delete the branch after merge.
- Link the issue with `Closes #<N>`. Every PR description covers why, what, the rules at play, and the decision-filter outcome.
- **Trivial PRs** (typo, dep bump, dead-code/formatting; no behavioural change) may collapse the decision-filter / states / rules blocks to `N/A — trivial change`. Why / what / verification stay mandatory; if any rule applies, the exception is void.

## Verification

Run `$LINT_CMD` and `$BUILD_CMD` before every commit. Run `$VERIFY_CMD` (from `STACK.md`) once before every push, on the exact committed tree you push; it must pass with no new warnings. The hand-off reports the pushed head SHA and the `$VERIFY_CMD` summary line, or the stamp line when `STACK.md` defines one. The reviewer runs `$VERIFY_CMD` once per PR, on the head it passes. `STACK.md` states which other checks run when, and which only the owner runs. Always go through the named commands (`$FORMAT_CMD`, `$LINT_CMD`, `$BUILD_CMD`, `$TEST_CMD`, `$VERIFY_CMD`); never invoke the underlying tools directly.

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

On the critical execution path (whatever `STACK.md` declares — UI thread, event loop, request hot path): keep synchronous work within the budget; run anything slower off-path with a placeholder, last-known-good value, stream, or pagination; give every external call a timeout and graceful fallback; render large collections lazily with stable ids; load assets via async loader or thread-safe cache; do no expensive work in code that runs on every event — cache derived results; never make navigation or input wait on I/O. Prefer continuity over blankness. Back a hot-path change with the performance evidence that `STACK.md` asks for. Pause background work when the surface is inactive.

## States handled

Every visible surface handles the states `VISION.md` and `STACK.md` declare — commonly awaiting-first-data, success, empty, degraded, permission-blocked, offline, error, plus product-specific. Previews / stories / fixtures exercise each applicable state.

## Time

Treat time like any other external input: work in one absolute reference (UTC) everywhere internally — logic, domain values, persistence, caches, and logs — and convert to or from a zoned/local representation only at the boundary (normalise inbound values on parse; convert outbound values when rendering a user-facing value). Nothing between the edges holds local time. Never hand-roll timezone-offset arithmetic; use the platform time APIs named in `STACK.md`. Instants crossing a persistence or wire boundary are serialised in UTC. `STACK.md` pins the concrete types and calls.

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

Value types and immutable bindings by default; reference types/mutation only when identity or shared mutation is needed. Composition over inheritance; small purpose-driven types; files named for their primary type. No unsafe unwraps/coercions outside tests; no broad type erasure without a measured benefit; no global mutable state or singletons unless an API requires one. Delete dead code; comment per **Comments** below. No debug output in shipped code — use the logger in `STACK.md`, which names the banned calls. Run `$FORMAT_CMD` before committing.

### Comments

A comment earns its place by stating a **constraint a reader would otherwise break** — units, ownership, failure behaviour, an actor or thread requirement, what a caller must not do. It does not describe the code. Default to none: code that needs explaining is a naming or structure defect, so fix the code first. Doc-comment an exported symbol only when the name and the signature leave a contract unstated.

The list below is the rule. The budget is a smell that points at it: a comment runs to at most 5 lines. Past that the content is usually rationale, not a constraint — move it to the issue, the PR, or `STACK.md`, and leave a pointer. A comment carrying two distinct constraints splits into two comments; it is not cut to fit. A comment over 5 lines that holds only constraints stays, and the reviewer says so. Never cut a contract to reach a number.

Never write:

- **History.** What the code used to be, what a fix changed, what a design replaced, what a measurement was. The commit, the PR, and the issue hold that record. A comment describes the present only.
- **Rationale and rejected alternatives.** Why an option lost, notes from a design session, measured numbers. These go to the issue, the PR, or `STACK.md → Intentional Divergences`.
- **A reference that does not resolve inside the repository.** Delete every issue number, PR number, and commit reference from the comment: it must still read correctly. A bare `#170` or "the previous shape" is not a reference; a named `STACK.md` section is.
- **The same explanation twice** — in a type doc and again at the call site, or in the source and again in a `STACK.md` section. Name the section instead of restating it.
- **Anything answering the current task or its author.** Tell the user instead.
- **A line number, a file offset, or a count of things elsewhere** — a later edit invalidates it silently.

Write for a reader who has this file and nothing else: no issue, no chat, no external schema. Read each comment back cold, as a standalone sentence — an unclear referent is a defect even when the content is right. Do this while writing: a later pruning pass tests redundancy, not clarity. A note about an implementation choice sits at the line that makes it, not in the doc comment.

Keep an existing comment unless the change makes it wrong. A comment that breaks this policy is already wrong: prune it when you touch that code.

## Dependencies

Default to no — especially for what the platform already solves. A genuinely needed one uses the package manager in `STACK.md`, compiles clean in the strictest mode, and is added to `STACK.md → Approved Dependencies` with rationale, approver, and date.

## Reject changes that…

violate a decision-filter question or add a `VISION.md → Non-Goals` feature; add a competing framework or boilerplate where a smaller owner suffices; put heavy work on the critical path or in per-event code; couple the interface layer to network/storage/sensor internals; store or compute in local time (or hand-roll timezone-offset math) instead of UTC-internally with conversion only at the boundary; hide failure behind infinite spinners or use parallel booleans for a state machine; suppress warnings with escape hatches; spawn fire-and-forget async with no ownership or cancellation; add a dependency for what the platform solves or lower the minimum version in `STACK.md`; introduce debug output, stubs, or commented-out code, or log PII; narrate history, rationale, or an unresolvable issue/PR reference in a comment instead of the issue or the PR (`Code conventions → Comments`); add singletons/DI containers without `STACK.md` approval; or break any `STACK.md → Stack-specific reject-list additions` rule.

## Definition of done

Responsive under slow network / denied permissions / degraded data / load; every applicable state handled; no heavy work on the critical path; every async path cancellation-safe; no new persisted/transmitted data violating `VISION.md` or `STACK.md`, no PII in logs; tests cover new domain logic and run clean in the strictest mode; accessibility considered for user-facing surfaces; `$VERIFY_CMD` green; privacy declarations and docs updated when relevant.

## Autonomy fallback

When a decision is ambiguous and not derivable from `VISION.md`, `STACK.md`, this file, or the issue: pick the smallest-surface, most-conservative interpretation that passes the decision filter, document it in the PR (and the issue if it binds future work), and proceed. **Do not call `AskUserQuestion`** — the only exception is direct edits to `VISION.md` or this file, which need an explicit user request. If `$VERIFY_CMD` keeps failing after 10 attempts, stop: push a `chore/abandoned-<task>` branch, open a draft PR (or comment on the PR and issue) describing the failure, and leave it for a human.

## Intentional divergence

Valid but deliberate: measurable need, clear benefit, isolated exception, documented reason. Record it in `STACK.md → Intentional Divergences`. Divergence from `VISION.md` needs the product owner.

---

## Safeguards

Protect `main` in the repository settings: no direct push and no force-push. That protection is the real gate. Enforce these rules with Claude user or project settings when available: deny pushes to `main`; deny recursive deletion and hard reset; refuse `.env` reads; block direct `claude` CLI calls from Bash; and allow `gh pr merge` only after an explicit user request. `template/.claude/settings.json` is the reference configuration. These doctrine rules remain mandatory when the reference settings are not installed. Never open `.env` files through another channel. Never put secrets, credentials, or tokens in the repository or logs.

## Decision rights

- **Auto-allow**: read-only commands, the `STACK.md` build/test/lint commands, feature-branch ops (create, commit, push origin `<branch>`, force-push with `--force-with-lease`), PR creation, `gh pr view`/`comment`/`diff`/`review`, `gh issue view`/`list`/`comment`, `STACK.md` edits.
- **Ask first**: edits to `VISION.md` or `CLAUDE.md`, creating/restructuring issues, `gh api` calls changing repo settings. `gh pr merge` only when explicitly asked.
- **Never**: push to `main` (normal or force), bare `git push --force` on any branch, bypass hooks (`--no-verify`), `rm -rf` in the project, or persist/transmit data forbidden by `VISION.md → Persistence and Privacy Posture`.
