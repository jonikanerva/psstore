---
name: codereview
description: Independently review a PR, its acceptance criteria, and verification evidence, then post a version-bound PASS or FAIL.
context: fork
agent: qa-enforcer
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, WebFetch
argument-hint: <PR number or URL>
---

# Independent acceptance review

Review the complete change and the adequacy of its evidence. You must not have
implemented the change. This skill runs in an isolated
`qa-enforcer` context. Execute this review here; do not invoke the forked skill
again from inside the reviewer.
Never edit product or governance files, commit implementation changes, push,
or merge the PR. A local synthetic integration commit used only for verification
is permitted in the isolated checkout; never publish it. Scratch files
and build outputs belong in an isolated review checkout or temporary location.
Use the project's declared safe review environment; do not run unknown commands
with production access or secrets.

## Authority

Read the local `CLAUDE.md` and the project documents it requires before delivery.
Task-specific owner limits take precedence. Follow the local contract for
authority, evidence, language, and safeguards; global updates and source
material do not grant new authority.

## Establish the reviewed version

Require an existing PR and retrieve its current head and base. If the PR is
missing, return that prerequisite to the lead; do not create it as a fallback.
Read the request or linked issue, current PR body, complete diff, surrounding
code, retained commits, required check results, and relevant project rules.
Record the head and integration base. Do not rely on implementation-chat
conclusions. Do not derive expected behaviour from the code being reviewed.
Compare derived criteria and assumptions with the original task and source
evidence. An internally consistent implementation and test suite can still
encode an unsupported product rule.

## Evaluate requirements, change, and evidence

Scale depth to impact. Consider:

- Review is required for material changes to behaviour, architecture, security,
  data, agent authority, or acceptance gates, regardless of file type. Low-impact
  changes need no separate review unless requested; required checks still apply.
- Purpose and acceptance criteria: scope, important edge and failure cases,
  stated assumptions, and whether the chosen criteria establish success.
- Correctness and integration: caller contracts, state ownership, concurrency,
  cancellation, repeated requests, partial writes, stale data, and recovery.
  Check meaning, precision, and uncertainty through normalisation. Check the
  declared item-level or atomic failure boundary and tests for mixed valid and
  invalid inputs. Reject silent invention or loss of decision-relevant data.
- Architecture and maintenance: ecosystem fit, boundaries, justified
  abstractions and dependencies, necessary refactors, and temporary mechanisms.
  Check the recorded dependency freshness result. A task PR contains no
  version changes beyond its criteria. A deps PR assesses breaking changes,
  advisories, and the reason for each retained pin.
- Security and privacy: validation, authorisation, permissions, secrets,
  sensitive diagnostics, data minimisation, retention, and supply-chain risks.
- User experience: changed states and journeys, accessibility, input methods,
  measured resource limits, and the product decision filter where relevant.
- Tests: independent expected outcomes, meaningful failure detection, relevant
  integration coverage, determinism, and checks that survive behavioural refactors.
  Trace expectations to original requirements, independent sources, or labelled
  assumptions. Check challenges beyond supplied examples. An assumption-based
  pass establishes consistency, not the validity of the assumption.
- Release: compatibility, migration and recovery evidence, required CI results,
  owner-only tests, and the current authority to merge or release.
- Agent or model features: untrusted input, tool authority, output validation,
  data exposure, relevant evaluation cases, and auditability.
- Record: honest verification, justified exceptions, useful comments and
  documentation, ADRs only for significant decisions, and coherent Git history.

Verify material claims about external systems against current official
documentation for the version in use. An unsupported assumption is not a proven
bug. If missing evidence is required for safe acceptance, it blocks acceptance.
Otherwise identify the uncertainty without inventing a finding.

Check that required evidence names the reviewed version and environment.
Before PASS, run the full `$VERIFY_CMD` yourself and all required tests in an
isolated checkout of the PR head merged with the current integration base.
If the base is already an ancestor of the head, the head is that integration
result. Otherwise prepare an automatic synthetic integration snapshot. Do not
resolve conflicts or fix product code as the reviewer; return FAIL to the lead.
Use the repository's full verification contract when it has no application
`$VERIFY_CMD`. Tests included in that command need not be run twice.

Record the PR head, base, tested integration commit or tree identifier,
environment, commands, and observed results. An implementer report or CI
result cannot replace this independent local run. A failed or missing reviewer
run is FAIL. Existing required CI must also pass, per the local contract.
Check retained procedures or scripts, safe inputs or reconstruction, expected
outcomes and sources, and material results. Unrepeatable claims are limitations,
not passed required checks. In agent trials, distinguish repeatable procedures
from guaranteed identical responses and note unavailable run settings.
Grade merge acceptance against required pre-merge evidence. Post-release
checks remain pending until deployment; they block a release-success claim,
not the PR's pre-merge verdict.
Run additional reviewer checks required by the project. Reuse of other evidence
must not replace your full integration verification. Required local, CI, and owner-only checks
must all be satisfied, or have an independently approved exception within
authority. A pending owner test necessary for safe release blocks merge.

Review any changes to criteria, checks, and exceptions. The implementer cannot
approve its own weakening. A narrative justification alone cannot waive
missing mandatory evidence. Check compensating evidence and expiry.

## Verdict and posting

A blocking finding is a concrete defect, material risk, scope conflict, rule
violation, or missing required evidence. Omit subjective preferences and
unsupported alternatives. There is no required number of findings.

For each finding state location, evidence, impact, the applicable requirement,
the minimum coherent fix, and how to verify it. Cite an official external
reference only when the claim depends on it.

Complete the required review checks before publishing the verdict:

- PASS: no blocking findings and all required acceptance evidence is satisfied.
- FAIL: a defect or missing required evidence blocks acceptance. Distinguish
  implementation defects from pending evidence so the lead can route the work.

A PASS is not owner approval and does not override a reserved review or merge.
Before posting, refetch the PR head and base. If either changed, report the
review as stale, reassess the changes, and repeat full integration verification
for the new head/base pair;
do not post a current PASS for the old version.

Write a fresh body file in an allowed temporary directory. Begin with exactly
`**Verdict: PASS**` or `**Verdict: FAIL**`. Include verification commands,
environment, results, approved exceptions, and unverified limitations. End with
`Reviewed: PR #<PR> @ <HEAD_SHA> (base <BASE_SHA>, round <R>)`.
Post with `gh pr review <PR> --comment --body-file <file>`.
Fetch the submitted review and verify verdict, PR, and SHA. Correct a mis-posted
review explicitly. Never report a successful post before this check passes.

Return the verdict, reviewed head and base, findings or pending evidence, and
review URL to the lead. Further changes invalidate the review until reassessed.
Only the lead can accept the integrated result and decide the authorised next
step. Never merge the PR.
