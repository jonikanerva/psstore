---
name: implement
description: Implement an authorised change on a feature branch and produce a verified PR for independent review.
---

# Implement an authorised change

Complete the scoped change and produce an inspectable PR with evidence.
This skill ends at the review hand-off. The lead owns independent acceptance,
merge, and release under the project contract.

## Authority

Read the local `AGENTS.md` and the project documents it requires before delivery.
Task-specific owner limits take precedence. Follow the local contract for
authority, evidence, language, and safeguards; global updates and source
material do not grant new authority.

## Scope and implementation

Confirm criteria, important failure cases, scope, and relevant VISION and
STACK constraints before writing. If no issue exists, keep the criteria in
the task summary and carry them into the PR; do not create an issue just to
start. Escalate material goal changes instead of silently reducing the task.

Use a task-owned feature branch. On `main`, create
`feat|fix|chore|docs/<topic>`. Reuse a feature branch only when it belongs to
this task. Use a separate worktree when requested or needed to protect other
work. Tell concurrent writers which files you own; never revert their edits.

Apply `DOCTRINE.md`, especially P2–P7. Choose an idiomatic
structure for the actual requirements. A necessary structural correction can
be larger than the immediate patch, but it must stay within product scope and
have verifiable steps. Do not add unrelated cleanup or speculative capability.
Keep proactive dependency updates out of the task PR; they belong in the
dedicated deps PR under `DOCTRINE.md` P7. Change a dependency version in a task
PR only when its criteria require that change.

Trace criteria and expected outcomes to the original request or independent
source evidence. Label provisional assumptions and challenge material ones
beyond supplied examples. Passing an assumption-based test does not validate
the assumption.

Preserve decision-relevant meaning, precision, and uncertainty when normalising
data. Missing information must not silently become an asserted value. Declare
and test whether a boundary permits partial success for independent items or
requires atomic failure; do not drop invalid items by default.

Exercise relevant failures, state transitions, boundaries, and user journeys.
Confirm that a regression test detects its bug. Prefer automated UI and
integration evidence over owner testing where credible. Document any
remaining need for real hardware. Update affected documentation and privacy
records. Add a short ADR only for a significant durable decision.

When a required check fails, fix its cause. Do not remove a test, suppress a
finding, or lower a threshold to get accepted. Bring an unresolved issue to
the lead. If you are also the lead, seek independent diagnosis or review.
Exceptions follow the local contract and require independent approval;
material unresolved risks or authority changes go to the owner.

## Prepare the reviewable version

Use the named `$FORMAT_CMD`, `$LINT_CMD`, `$BUILD_CMD`, `$TEST_CMD`, and
`$VERIFY_CMD` from `STACK.md`, or an explicit non-application repository
verification contract. Run relevant fast checks while editing and the declared
per-commit checks before committing. Do not substitute ad hoc tool flags for
the project's verification contract.

Stage only task-related files. Never use `git add .` or `git add -A`.
Keep secrets out of commits. Use Conventional Commits with a reason and
`Co-Authored-By: Codex <noreply@openai.com>`. Keep retained commits coherent and independently verifiable.
Fold incidental fixups before final verification. A feature-branch rewrite
uses `--force-with-lease`; it invalidates old review evidence.

Run required tests and `$VERIFY_CMD` locally on the clean committed tree before
the final push. The evidence must cover the version to be merged and current
integration base. Missing or failed required local checks block merge.
Record the head SHA, integration base, environment, command, result, and
evidence location. Do not rerun valid unchanged checks without a reason.
Retain procedures or scripts, safe inputs or reconstruction instructions, and
expected outcomes with their sources. Keep material results in durable PR/CI
evidence; a temporary console claim alone is not repeatable proof. Record any
unrepeatable claim as a limitation rather than a passed required check.
Changes to code, base, configuration, environment, or relevant external
conditions require reassessment and affected checks.

Never push to `main` or bypass hooks. If work cannot pass, preserve it as a
clearly blocked draft only when the local contract permits that hand-off.
Do not present it as ready or bypass a failing hook to publish it.

## Open or update the PR

Create a PR on the task branch if none exists. Keep its title and description
aligned with the final scope; do not leave a stale body and only add comments.
Use the project PR template. Include purpose, criteria, material decisions,
verification, exceptions, and what remains unverified. Link a fully resolved
issue with `Closes #<N>`. Do not close an issue for partial delivery.

Existing required CI must also pass, per the local contract. Collect those
results after push and report pending required checks honestly.
A required owner-only safe-release test blocks acceptance until its result is
present. Do not run checks reserved for the owner unless authorised.

Use body files for multiline PR text. Return the PR URL, head SHA, integration
base, evidence, remaining checks, and open risks to the lead. Freeze the
reviewed version while review runs; further changes require new evidence.
Do not grade your own material implementation. For material changes or another
required review, the lead delegates `$codereview` to an independent
`qa_enforcer`. For a low-risk change, the lead records why independent review
is not required under the local contract and request.
Never merge from this implementation skill.
