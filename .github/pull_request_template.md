<!-- Keep this proportional to the change. Use short, active English sentences.
Remove instructions and replace placeholders before saving. -->

## Purpose and scope

<Problem, intended outcome, and what this change delivers.>
<Put any decisive unresolved owner decision or product blocker first.>
<Link a fully resolved issue with Closes #N when applicable.>

## Acceptance criteria

<Observable behaviour, important failure cases, and the evidence for each.>
<Trace criteria to the original request or source evidence. Separate material
assumptions from requirements and observed facts; state unresolved user-visible effects.>

## Decisions and authority

<Material choices and relevant product constraints. Link significant ADRs only.>
<Owner-reserved review, testing, merge, or release; required escalations and their outcome.>

## VISION decision filter

<Answer each question in `VISION.md → Decision Filter` with yes or no and a
one-line reason. A "no" blocks the change; propose the smallest alternative.>

## States handled

<For a change to a user-facing surface, list each applicable `STACK.md → 0.
Project shape` state that the change renders, or write not applicable.>

## Verification

- Version and integration base: <head SHA and base SHA>
- Environment: <toolchain, configuration, platform, and relevant fixtures>
- Required checks: <command or CI job, result, and evidence for this version>
- Reproduction: <procedure/script, safe inputs or reconstruction, expected
  outcomes and sources, retained result links; agent trial inputs/settings if used>
- Independent review: <required or not, reason, and review link when complete>
- Required owner-only checks: <none triggered, or each `STACK.md → 4. Build & verify commands → Other checks`
  entry as `ran on <SHA>: PASS` or `triggered, pending owner run`>

## Unverified work and exceptions

<Lead with any decisive unresolved risk. State what was not verified and its
effect on acceptance. Unrepeatable claims are limitations, not passed checks.
Use none with a reason
when all applicable evidence is present. Missing required evidence blocks merge.
Link each approved exception with its scope, compensating evidence, approver,
and expiry or reassessment condition.>

## Release and recovery

<Applicable release trigger, migration/compatibility evidence, recovery path,
and post-release checks. Use not applicable with a reason for non-release work.>
