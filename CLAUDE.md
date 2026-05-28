@AGENTS.md
@VISION.md
@STACK.md

# Claude Code workflow

`VISION.md`, `AGENTS.md`, and `STACK.md` are the single sources of truth for product and technical rules. Backlog, milestones, active strategic constraints, and open risks live in GitHub Issues (see "Backlog and milestones" below). This file only adds Claude-Code-specific operational rules (skills, verification, git workflow, safeguards, decision rights). Nothing is duplicated from the other documents.

## Autonomy

This project runs on the autonomous "default agent stack" pattern. Invoke the `/project-manager` skill — it is the team-lead entry point. The skill runs in two phases: an interactive Phase A where it interprets your prompt, asks any genuinely ambiguous clarifying questions, and waits for explicit plan approval; and an autonomous Phase B where it spawns the four-teammate agent team (`architect`, `lead-dev`, `qa-enforcer`, `ux-guardian`) and drives the work to completion without further prompts. The PM role itself lives in the skill — the lead is the PM in agent-teams mode.

The autonomy fallback rule from `AGENTS.md §14.1` applies in Phase B: when a decision is ambiguous, pick the smallest-surface, most-conservative interpretation that satisfies the `VISION.md` decision filter, document the choice in the PR description (and, if it introduces a binding constraint for future work, open a GitHub issue with the `decision` label linking that PR), and proceed. Do not call `AskUserQuestion` in Phase B. The only exceptions are (1) Phase A of the `/project-manager` skill, which is interactive by design, and (2) direct edits to `VISION.md` or `AGENTS.md`, which always require an explicit user request.

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

`$VERIFY_CMD` is declared in `STACK.md`. It is the single source of truth for how to verify, lint, build, and test this project. Never invent raw tool invocations (`swift-format`, `xcodebuild`, `eslint`, `tsc`, etc.) in commits, CI, or agent scripts — always go through the named command in `STACK.md`.

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

- `/project-manager <prompt>` — orchestration entry point. Free-form prompt; the skill classifies it into a mode (autonomous-build, single milestone, bootstrap, audit, PR review, investigation, custom), clarifies if needed, proposes a plan, and only spawns the team after explicit user approval. Milestone status, strategic decisions, and open risks live in GitHub Issues (label `milestone` / `decision` / `risk`); the skill reads and updates those issues directly.
- `/implement <task>` — feature branch → change → `$VERIFY_CMD` → commit → push → PR. Enforces the `VISION.md` decision filter and the `AGENTS.md §14` workflow rules. The `lead-dev` teammate calls this once per milestone.
- `/codereview` — isolated subagent review of the current branch against `main`. It applies the project governance files first, then risk-based review lenses for correctness, architecture, concurrency, security, privacy, reliability, performance, tests, supply chain, and operability. It posts a plain-text PASS or FAIL PR comment as the audit-trail entry. Every FAIL finding must include evidence, impact, violated local rule, minimum fix, and verification; external standards such as OWASP, CWE, NIST SSDF, SLSA, 12-Factor, ISO/IEC 25010, OpenTelemetry, or OWASP LLM Top 10 are cited only when materially relevant. The `qa-enforcer` teammate calls this after each `/implement` finishes.

## Backlog and milestones

Backlog, milestones, active strategic constraints, and open risks live in **GitHub Issues**, not in a tracked file. The audit trail of what happened and why is the git history of `main` (merge commits, never squash) plus PR descriptions and comments. Issues are the forward-looking plan; merged PRs are the durable record.

Labelling convention:

- `milestone` — a unit of upcoming work with a scope description. The issue body lists scope (in), scope (out), files to add / remove, and verification steps — self-contained enough for an agent to execute.
- `decision` — a binding architectural or product constraint currently in force. Each `decision` issue summarises the rule, links the originating PR, and stays open as long as the constraint applies. When superseded, the issue is closed and a new `decision` issue is opened (cross-linked).
- `risk` — an active risk threatening a milestone, with failing-condition and mitigation in the issue body. Closed when mitigated; the PR that mitigated it is the audit trail.

Every milestone PR updates the relevant issue before being merged:

1. When the branch is opened, leave a comment on the milestone issue with the branch link and move the issue to `In progress` (via project board or status field).
2. Before merging, comment on the milestone issue with the PR link and close it on merge.
3. If a new binding constraint surfaces mid-PR, open a `decision` issue. If a new risk surfaces, open a `risk` issue. Close those issues only when superseded (decisions) or mitigated (risks).

The full rationale for any decision lives in the PR that introduced it. Never write PII or any data forbidden by `VISION.md → Persistence and Privacy Posture` into issue titles, bodies, or comments.

## Safeguards

Safeguards are implemented in `.claude/settings.json` (permissions + hooks). The list below is a reminder; the authoritative enforcement lives in settings.json.

- `git push --force` and `git push origin main|HEAD:main`: blocked by the `PreToolUse` Bash hook and the deny list.
- `rm -rf`: deny-listed (requires an explicit permission prompt).
- `gh pr merge`: **never run on the agent's own initiative.** Merging always requires an explicit user request. The command itself is not deny-listed, so the agent may execute it _when asked by the user_, but never autonomously.

## Decision rights

- **Auto-allow**: read-only commands, `STACK.md` build/test/lint commands, feature-branch operations (create, commit, push origin `<branch>`), PR creation, `gh pr view` / `comment` / `diff` / `review`, `gh issue create` / `comment` / `edit` / `close` (for milestone / decision / risk issue stewardship), `STACK.md` edits.
- **Ask first**: edits to `VISION.md` or `AGENTS.md`, `gh api` calls that modify repo settings. `gh pr merge` is allowed only when the user explicitly asks for it.
- **Never**: force push, push to `main`, bypass hooks (`--no-verify` etc.), `rm -rf` anything inside the project, violate any guardrail in `AGENTS.md §13`, persist or transmit data forbidden by `VISION.md → Persistence and Privacy Posture`.
