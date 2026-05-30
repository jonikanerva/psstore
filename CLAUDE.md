@AGENTS.md
@VISION.md
@STACK.md

# Claude Code workflow

`VISION.md`, `AGENTS.md`, and `STACK.md` are the single sources of truth for product and technical rules. The backlog lives in GitHub Issues (see "Backlog" below). This file only adds Claude-Code-specific operational rules (skills, verification, git workflow, safeguards, decision rights). Nothing is duplicated from the other documents.

## Autonomy

This project runs on the "default agent stack" pattern. Invoke the `/project-manager` skill — it is the team-lead entry point. You prioritise the backlog and tell the PM which issue to take ("do issue 35") or design ("plan how to build issue 42"); the PM does not pick work on its own. The skill runs in two phases: an interactive Phase A where it interprets your prompt, asks any genuinely ambiguous clarifying questions, and waits for explicit plan approval; and an autonomous Phase B where it spawns the agent team (`architect`, `lead-dev`, `qa-enforcer`, `ux-guardian`) and drives the issue you named to completion without further prompts. The PM role itself lives in the skill — the lead is the PM in agent-teams mode.

The autonomy fallback rule from `AGENTS.md §14.1` applies in Phase B: when a decision is ambiguous, pick the smallest-surface, most-conservative interpretation that satisfies the `VISION.md` decision filter, document the choice in the PR description, and proceed. Do not call `AskUserQuestion` in Phase B. The only exceptions are (1) Phase A of the `/project-manager` skill, which is interactive by design, and (2) direct edits to `VISION.md` or `AGENTS.md`, which always require an explicit user request.

## Language

Everything that lives in the repository or ever reaches GitHub is written in English. That includes:

- Source code, tests, and code comments
- Git commit messages and branch names
- PR titles, PR descriptions, PR review comments, PR inline comments
- Issue titles and issue bodies
- Any documentation, including this file

The _only_ exception is Claude's spoken replies back to the user in the chat window — those are in Finnish. The moment text is about to be written into a file, staged, pushed, or posted to GitHub, it is in English.

## Verification

Run before every commit and PR — all must pass:

```sh
$VERIFY_CMD
```

`$VERIFY_CMD` is declared in `STACK.md`. It is the single source of truth for how to verify, lint, build, and test this project. It is a local-only gate — there is no remote CI to fall back on, so every contributor MUST run it before committing and before opening a PR. Never invent raw tool invocations (`eslint`, `tsc`, `vitest`, `vite`, etc.) in commits or agent scripts — always go through the named command in `STACK.md`.

## Documentation protocol (Context7)

`STACK.md → Documentation protocol` is a **hard rule**: never write or modify code that uses a library from the model's memory — retrieve the version-pinned docs via Context7 first (Effect priors in particular drift to v2 / v4-beta). This applies to every agent and skill that writes code. Each PR records the Context7 docs it grounded. `architect` and `lead-dev` carry the obligation; `qa-enforcer` / `/codereview` verify the PR-description grounding artifact exists.

## Git workflow

- Use `/implement <task>` for the feature-branch workflow.
- Conventional Commits: `<type>(<scope>): <summary>`.
- Every commit authored by an agent ends with a `Co-Authored-By: <agent display name> <noreply@anthropic.com>` trailer (one trailer per agent that contributed to that commit). Human commits do not need the trailer.
- Branch names: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` (max 50 chars, lowercase, hyphens only).
- **Always merge to `main` with a merge commit — never squash.** The PR keeps its full commit history as the audit trail. This is enforced in the GitHub repo settings.
- Every PR description covers _why_ and _what_, the relevant `AGENTS.md` sections, and the `VISION.md → Decision Filter` outcome. The PR is the permanent audit trail.
- Delete the branch after merge.
- **Never** commit or push directly to `main`.
- **Trivial PR exception** — for typo fixes, dependency bumps, dead-code removals, formatting-only PRs, and other non-feature PRs (no behavioral change, no new state, no new dependency, no new persisted/transmitted data, no new external system), the `VISION decision filter`, `States handled`, and `AGENTS.md / STACK.md sections involved` blocks of the PR template may be filled with a single line: `N/A — trivial change, no behavioral surface affected.` The `Why`, `What`, and `Verification` sections are still mandatory. The `qa-enforcer` applies the `AGENTS.md §15` checklist as usual; if any rule does apply (e.g. a "typo fix" turns out to touch a privacy-relevant log line), the trivial-PR exception is forfeit and the full template fields are required.

## Skills

- `/project-manager <prompt>` — orchestration entry point. Free-form prompt naming the issue and what you want done; the skill classifies it into a mode (implement an issue, design an issue, audit, PR review, investigation, custom), clarifies if needed, proposes a plan, and only spawns the team after explicit user approval. The skill works the issue(s) you name; it does not create or curate issues on its own initiative.
- `/implement <task>` — feature branch → change → `$VERIFY_CMD` → commit → push → PR. Enforces the `VISION.md` decision filter and the `AGENTS.md §14` workflow rules. When the task corresponds to a backlog issue, the PR body carries `Closes #<n>` so the issue closes on merge. The `lead-dev` teammate calls this once per issue.
- `/codereview` — isolated subagent review of the current branch against `main`. It applies the project governance files first, then risk-based review lenses for correctness, architecture, concurrency, security, privacy, reliability, performance, tests, supply chain, and operability. It posts a plain-text PASS or FAIL PR comment as the audit-trail entry. Every FAIL finding must include evidence, impact, violated local rule, minimum fix, and verification; external standards such as OWASP, CWE, NIST SSDF, SLSA, 12-Factor, ISO/IEC 25010, OpenTelemetry, or OWASP LLM Top 10 are cited only when materially relevant. The `qa-enforcer` teammate calls this after each `/implement` finishes.

## Backlog

The backlog lives in **GitHub Issues**. One issue is one backlog item, at whatever granularity makes sense — a feature, a fix, a chore, a question to settle. There is no required label taxonomy and no label-driven state machine: the human owns prioritisation and tells the PM which issue to take.

How an issue moves through the workflow:

1. The human points the PM (or `/implement`) at a specific issue — "do issue 35", "plan how to build issue 42". Agents do not pick work, open issues, or curate the backlog on their own initiative. (If asked directly — "open an issue for X" — an agent may create one; that is the only path.)
2. The feature branch implements the issue. The PR body opens with `Closes #<n>` so that merging the PR closes the issue automatically. That single line is the only backlog bookkeeping the workflow requires — no progress comments, no status labels, no "shipped" comments.
3. Binding constraints discovered along the way are documented in the PR description, and — when they are technical and durable — in `STACK.md → Intentional Divergences`. They are not tracked as separate issues.

The audit trail of what happened and why is the git history of `main` (merge commits, never squash) plus PR descriptions and comments. Issues are the forward-looking backlog; merged PRs are the durable record. Labels may be used freely for the human's own prioritisation, but no part of the workflow depends on them. Never write PII or any data forbidden by `VISION.md → Persistence and Privacy Posture` into issue titles, bodies, or comments.

## Safeguards

Safeguards are implemented in `.claude/settings.json` (permissions + hooks). The list below is a reminder; the authoritative enforcement lives in settings.json.

- `git push --force` and `git push origin main|HEAD:main`: blocked by the `PreToolUse` Bash hook and the deny list.
- `rm -rf`: deny-listed (requires an explicit permission prompt).
- `gh pr merge`: **never run on the agent's own initiative.** Merging always requires an explicit user request. The command itself is not deny-listed, so the agent may execute it _when asked by the user_, but never autonomously.

## Decision rights

- **Auto-allow**: read-only commands (including `gh issue view` / `list`), `STACK.md` build/test/lint commands, feature-branch operations (create, commit, push origin `<branch>`), PR creation, `gh pr view` / `comment` / `diff` / `review`, `STACK.md` edits. Agents do not create, label, or close issues on their own initiative; the backlog is human-curated and the PR's `Closes #<n>` line handles closing. `gh issue create` / `comment` / `edit` / `close` are run only when the user explicitly asks.
- **Ask first**: edits to `VISION.md` or `AGENTS.md`, `gh api` calls that modify repo settings. `gh pr merge` is allowed only when the user explicitly asks for it.
- **Never**: force push, push to `main`, bypass hooks (`--no-verify` etc.), `rm -rf` anything inside the project, violate any guardrail in `AGENTS.md §13`, persist or transmit data forbidden by `VISION.md → Persistence and Privacy Posture`.
