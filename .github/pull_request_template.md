<!--
Fill every section. Remove this comment before saving.
The /implement skill drafts this for you. Verify, then ship.
Use Simplified Technical English.
Write short sentences.
Use active voice and plain terms.
-->

## Why

`<One-paragraph motivation. What problem is this PR solving and which VISION.md / operating-contract / STACK.md rule is at play.>`

Closes #`<issue number, if this PR resolves a GitHub issue>`

## What

`<Bulleted technical summary of the changes. Files added / removed / changed.>`

- `<change 1>`
- `<change 2>`
- `<change 3>`

## VISION decision filter

The four questions in `VISION.md → Decision Filter`:

1. `<Question 1 verbatim>` — **`<yes / no>`**. `<one-line rationale>`.
2. `<Question 2 verbatim>` — **`<yes / no>`**. `<one-line rationale>`.
3. `<Question 3 verbatim>` — **`<yes / no>`**. `<one-line rationale>`.
4. `<Question 4 verbatim>` — **`<yes / no>`**. `<one-line rationale>`.

If any answer is `no`, this PR documents the conflict in the **Why** section above and proposes the smallest idiomatic alternative — and, if the rejection establishes a binding constraint for future work, also states it in the linked issue. Otherwise: all four are `yes`.

## Rules involved

- `<CLAUDE.md or AGENTS.md> → <rule by name>` — `<one-line how this PR honours it>`
- `STACK.md → <section>` — `<one-line>`

## Verification

- [ ] `$VERIFY_CMD` (per `STACK.md → Build & verify commands`) ran once on the pushed head and is green: `<summary line, or the stamp line when STACK.md defines one>`.
- [ ] `$FORMAT_CMD` is idempotent (re-running produces no diff).
- [ ] Tests added or updated for new logic.
- [ ] Previews / stories / fixtures cover the new states.
- [ ] Privacy declaration updated if a new required-reason / required-data API was adopted.
- [ ] Owner-run checks (per `STACK.md`): `none triggered`, `none declared`, or each triggered check as `ran on <SHA>: PASS` or `triggered, pending owner run`.
- [ ] The issue this PR resolves is linked with `Closes #<N>` above. Any binding decision introduced (if any) is stated in plain language in this description and the issue.

## States handled

For changes that affect a user- or caller-facing surface, list every state it renders:

- [ ] loading / awaiting first data
- [ ] success
- [ ] empty
- [ ] degraded
- [ ] permission-blocked
- [ ] offline / error
- [ ] `<product-specific state from VISION.md>`

## Notes for reviewer

`<Anything the reviewer should know that the diff alone does not surface — e.g. an autonomy-fallback default taken, a deferred decision, an open risk.>`

---

**Next step:** run `/codereview` in Claude or `$codereview` in Codex on this branch. The autonomous flow runs it automatically; if you opened this PR by hand, run the matching host skill before requesting merge.
