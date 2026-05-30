---
name: codereview
description: Review all changes on the current branch against main as an isolated subagent. Posts a risk-backed PASS/FAIL audit comment to the PR.
context: fork
agent: general-purpose
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, WebFetch, Skill, ToolSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

Review all changes on the current branch against `main`. **This skill runs as an isolated subagent** — do not rely on any prior conversation context. Derive all understanding from the PR diff, description, check output, and the project's governance files only.

Communicate in Finnish when reporting progress to the user; write the PR-review comment itself in English (project policy: all PR artifacts are in English).

## Prerequisites

- A PR must exist for the current branch. If not, the autonomy fallback applies: do NOT call `AskUserQuestion`. Instead, run `gh pr create` against the current branch with a minimal title / body derived from the latest commit, then proceed. (The lead-dev should already have done this; the fallback is for races where it has not.)
- Read: `gh pr view --comments`, `gh pr diff`, `gh pr checks`, and the governance files `VISION.md`, `AGENTS.md`, `STACK.md`, `CLAUDE.md`, `README.md`.
- Inspect the branch history with `git log main..HEAD --oneline`.
- Prefer reviewing the whole changed surface, not only the displayed diff hunk. Follow call sites, state ownership, service boundaries, tests, previews / stories, build scripts, and configuration touched by the change.

## Quality standard

The bar is the quality target stated in `VISION.md → Success Definition`, `AGENTS.md §15 Definition of done`, and `STACK.md → Performance budgets`.

**Every blocking finding is a FAIL.** A blocking finding is any rule-backed defect, regression risk, missing required evidence, security / privacy issue, production failure mode, required-test gap, unsupported dependency / build-system change, or mismatch with the PR's stated scope.

Do **not** fail a PR for subjective taste, personal style, or a possible alternative that is not clearly better under the local rules. If an observation is not actionable, not tied to the diff, or not tied to a violated project rule / material risk, omit it from the PR comment. This review is a merge gate, not a brainstorming session.

## Review lenses

Evaluate every PR through these lenses. Use the lenses to organize your reasoning; convert them into findings only when the evidence meets the blocking-finding bar.

1. **Functional correctness** — Does the changed code do what the PR claims? Are edge cases, empty inputs, invalid data, permission denial, retries, cancellation, and migration paths correct?
2. **Product and scope fit** — Does the change satisfy `VISION.md → Decision Filter`, avoid `VISION.md → Non-Goals`, and stay inside the scope of the GitHub issue the PR closes (if one applies to this branch)?
3. **Architecture and maintainability** — Does it preserve the layered shape in `AGENTS.md §3`, local ownership, obvious state flow, small purpose-driven types, and framework-native primitives?
4. **Concurrency and lifecycle safety** — Does it satisfy `AGENTS.md §4 C1–C13`, including UI-thread isolation, structured concurrency, cancellation, and thread-safe boundary types?
5. **Security and privacy** — Does it avoid injection, credential exposure, broken access control, PII leakage, overbroad permissions, forbidden persistence, and unsafe transport / logging?
6. **Reliability and failure modes** — Does it behave under slow network, degraded dependencies, missing permissions, first launch, cold start, backgrounding, low memory, and partial failure?
7. **Performance and resource budget** — Does it avoid hot-path work, UI-thread blocking, unbounded collection rendering, excessive allocation, battery drain, and bundle / memory budget drift?
8. **Test adequacy** — Do tests cover new domain logic, state transitions, edge cases, async timelines, and regression risks using the project's declared test framework?
9. **Supply-chain and dependency risk** — Are dependencies approved, lockfiles intentional, build scripts safe, CI permissions bounded, generated artifacts justified, and external tooling pinned where appropriate?
10. **Operability and observability** — Are errors actionable, logs privacy-safe, hot paths measurable where needed, and silent failures avoided?
11. **Accessibility and inclusive UX** — For UI surfaces, does the change honor dynamic / large text, screen reader semantics, focus order, contrast, reduced motion, color-independence, and keyboard / pointer alternatives? For copy and error messages, are they understandable to a non-expert?
12. **AI / agent behavior** — If the PR adds LLMs, prompts, retrieval, tool use, model output handling, or autonomous agents, does it handle prompt injection, tool authorization, data exfiltration, unsafe output trust, evaluation, and auditability?

## Reference mapping

The project governance files are the primary source of truth. External standards are supporting references, not a replacement for local rules. Use them only when they materially apply to the changed surface.

- **OWASP ASVS / OWASP Top 10** — web application security, authentication, authorization, input handling, session management, crypto, error handling, and logging.
- **OWASP API Security Top 10** — object-level authorization, broken authentication, unrestricted resource consumption, mass assignment, unsafe API consumption, and server-side request risks.
- **OWASP Cheat Sheet Series** — concrete implementation guidance for validation, output encoding, authentication, logging, secrets, transport security, and related appsec topics.
- **CWE Top 25 / CWE entries** — precise code-level weakness classification when a finding matches a known weakness.
- **NIST SSDF SP 800-218** — secure software development practice, vulnerability prevention, review evidence, and release discipline.
- **SLSA / OpenSSF Scorecard / OWASP SCVS** — build integrity, dependency governance, provenance, CI trust boundaries, SBOMs, and supply-chain hardening.
- **12-Factor App** — config, backing services, build / release / run separation, logs, disposability, and dev / prod parity for service-style projects.
- **ISO/IEC 25010** — vocabulary for broad product-quality concerns such as maintainability, reliability, performance efficiency, security, compatibility, portability, and usability.
- **OpenTelemetry** — observability vocabulary and instrumentation expectations when the project exposes services or distributed flows.
- **WCAG 2.2 / EN 301 549** — perceivable, operable, understandable, and robust UI; required baseline for any user-facing surface, especially in EU markets under the European Accessibility Act.
- **OWASP Top 10 for LLM Applications** — prompt injection, sensitive information disclosure, supply-chain risk, unsafe output handling, excessive agency, and model / tool misuse in LLM or agent features.

Do not cite a standard just to make a finding look stronger. The finding must stand on local evidence first. The reference mapping explains why the risk matters and gives the author a known remediation frame.

## Fact verification

Every finding must be grounded in evidence. Specifically:

- **Findings about the project's own rules** are grounded in the governance files — cite the section (`AGENTS.md §4 C2`, `VISION.md → Decision Filter`, `STACK.md → Approved Dependencies`, `CLAUDE.md → Language`, etc.). The files in the repo are the source of truth for project rules.
- **Findings that turn on external-tool behavior** — how Claude Code treats a setting, how the build tool parses a config key, what `gh` does with a flag, whether a strict-mode diagnostic exists, what a framework API requires, what GitHub's merge semantics are, what a security standard currently says — must be verified against **current official documentation** before being recorded.
- If the docs contradict the assumption, drop the finding.
- If the docs are silent or ambiguous after a reasonable lookup, report it as "could not verify" in a separate verification note rather than asserting it as a failure. Let the author decide.

This rule is narrow. It governs factual claims about how a system works or what an external standard requires. Style preferences, architectural critique, and rule compliance against the governance files still belong in the checklist below and are evaluated on judgment.

Lookups for this rule use documented WebFetch sources (`docs.claude.com`, the framework's official docs site, `docs.github.com`, `owasp.org`, `cheatsheetseries.owasp.org`, `csrc.nist.gov`, `cwe.mitre.org`, `slsa.dev`, `openssf.org`, `12factor.net`, `opentelemetry.io`, `w3.org`). **For library API claims (Effect, `@effect/platform`, TanStack, Tailwind, etc.), verify against Context7** (`STACK.md → Documentation protocol`) — resolve the library id, then a version-pinned query — rather than memory. If a lookup is required but not possible, the finding does not meet the verification bar — omit it or report it only as "could not verify".

## Specific zero-tolerance rules

The following are blocking findings when present in changed production code or required project artifacts:

- Dead code, unused imports, orphaned helpers, unreachable paths, or placeholder implementation.
- Code duplication when a shared helper exists or a small extraction clearly removes real duplication.
- `TODO` / `FIXME` / `HACK` / `XXX` comments, commented-out code, debug `console.log` / `dump`.
- Non-null assertions / unsafe casts (`as any`, `as unknown as`) outside tests, or any cast that bypasses an Effect `Schema` decode.
- Type-check escape hatches (`as any`, `@ts-ignore` / `@ts-expect-error` without an inline reason naming the constraint) — and any `@typescript-eslint/no-explicit-any` / `no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-member-access` violation, which are **error-level** gates that MUST fail the build (`STACK.md §1`, §7; `AGENTS.md §4 C13`).
- `throw` in domain / core logic instead of a tagged error in the Effect `E` channel (`STACK.md §0`, §7).
- An I/O module (`fetch`, cache, clock, `@effect/platform`) imported into a pure-core file, or `@effect/platform` imported outside the one HTTP adapter module (`STACK.md §7` lint boundaries).
- Sony / external data flowing past the boundary without an Effect `Schema` decode that narrows to PS5 / FI / EUR (`STACK.md §0`, §11).
- An Effect `Schema` decoder added or changed without narrowing + price-mapping tests (`STACK.md §11`).
- An `effect@4.x` / `next` / beta tag in `pnpm-lock.yaml` (`STACK.md §7`, §13).
- Library API usage not grounded in a Context7-retrieved, version-pinned docs entry recorded in the PR description (`STACK.md → Documentation protocol`) — especially Effect, where v2 / v4-beta priors drift in.
- Identifier whose meaning contradicts the function / type's documented responsibility, or that reuses a name already bound to a different concept in the same module.
- New code path whose cyclomatic complexity or nesting depth exceeds the limit declared in `STACK.md` (where one is declared) without an inline justification, or that introduces a control-flow shape the project's lint configuration has flagged.
- Inconsistency with established patterns in the codebase without an `STACK.md → Intentional Divergences` entry or local justification.
- Logging of values forbidden by `AGENTS.md §8`, `STACK.md → Logging & privacy`, or `VISION.md → Persistence and Privacy Posture`.
- New dependency, build step, generated artifact, or CI permission that is not documented and justified in the appropriate governance file.

## Review checklist

Evaluate the PR against all of these. **Every missed required check is a FAIL.**

1. **Scope verification** — Does the diff match the PR description? Are there undocumented changes, especially removals, renames, build changes, generated files, dependency changes, data-flow changes, or architectural shifts?

2. **VISION decision filter** — Read `VISION.md → Decision Filter` and verify all four questions still answer "yes" for what this PR actually ships. Also verify the PR is not pulling the project toward any category in `VISION.md → Non-Goals`, `AGENTS.md §13`, or `STACK.md → Stack-specific reject-list additions`.

3. **Functional correctness** — Verify the changed behavior against the stated requirement, surrounding code, edge cases, invalid inputs, empty states, first launch, repeated actions, partial failure, and backwards / forwards compatibility expectations.

4. **Security & privacy** — Check injection risks, credential exposure, overbroad access, unsafe output handling, PII leaks in logs, TLS requirements, permission scope, forbidden persistence, telemetry, analytics, and privacy declaration changes. Map to OWASP / CWE / NIST only when materially relevant.

5. **Threat modeling and reliability** — Ask what could go wrong in production: race conditions, degraded-data masking bugs, missing-permission paths, crashes on first launch, lifecycle bugs in long-running activities, stale caches, unbounded retries, timeouts, idempotency failures, and inconsistent recovery after cancellation.

6. **Code style and maintainability** — Check compliance with the formatter / linter declared in `STACK.md` and `AGENTS.md §10 Code conventions`. Enforce small types, clear naming, immutable bindings where practical, no broad type erasure, comments that explain why, and no cleverness without measurable benefit.

7. **Concurrency / async safety** — Check `AGENTS.md §4 C1–C13`, mapped in `STACK.md §10`: structured concurrency via `Effect.gen` / `Effect.all` / scoped fibers; cancellation via Effect interruption on scope exit + `AbortSignal` into `fetch` / TanStack Query; shared non-UI state behind Effect services / `Ref` / `Cache` provided by `Layer` (never module-level mutable singletons); no blocking the event loop; no sync-over-async bridge.

8. **UI / API responsiveness** — Check `AGENTS.md §5`: hot-path work stays within the budget declared in `STACK.md`; no heavy work in render / view-builder / middleware; lists are virtualized with stable ids; asset / data fetching uses async loaders or thread-safe caches; navigation and input do not wait on network / storage; last-known-good continuity is preserved where useful.

9. **Architecture compliance** — Check `AGENTS.md §3` + `STACK.md §0`: **functional core / imperative shell** — the pure core does not import I/O (`fetch`, cache, clock, `@effect/platform`); I/O is injected as Effect services via `Layer` (DI is Layer-based, services flat — no ad-hoc singletons, no second DI system, no generic service factories, `STACK.md §6` guardrail); HttpApi handlers are thin (decoded input → pure core → typed `E` channel → HTTP status); UI phases are tagged unions, not parallel booleans; `@effect/platform` confined to the one adapter module.

10. **Stack-specific rules** — Check `STACK.md → Stack-specific reject-list additions`. Every entry there is a hard rule for this project. Verify the PR honors all of them, including runtime, framework, persistence, logging, background, and dependency constraints.

11. **Dead code, duplication, leftover markers** — Scan the diff and touched files for unused functions, variables, parameters, imports, unreachable branches, orphaned helpers, copy-paste of existing helpers, `TODO` / `FIXME` / `HACK` / `XXX`, commented-out code, placeholder strings, and debug output. Zero avoidable debt at merge.

12. **Tests** — Check `AGENTS.md §9`: pure domain code has edge-case coverage; state holders driving screens / handlers are tested with fake or in-memory service boundaries and asserted timelines; async paths and cancellation-sensitive flows have tests where practical; no heavyweight mocking framework was added; all tests are strict-concurrency / strict-type clean.

13. **Supply-chain, dependency, and documentation-grounding trust** — Check dependency additions, lockfile updates (incl. no `effect@4.x` / `next` / beta tag), build scripts, generated files, package-manager configuration, tokens, deploy steps, and external tool invocations. Require documentation in `STACK.md → Approved dependencies` or `STACK.md → Intentional Divergences` when the local rules require it. **Verify the Context7 grounding artifact**: for every package in `STACK.md → Documentation protocol` the diff touches, the PR description must record the Context7 ID, question, and confirmed API shape; a missing entry is a blocking finding.

14. **Operability and observability** — Check that failures are visible to the user or operator at the right level, logs are structured and privacy-safe, hot paths have signposts / measurement where `STACK.md` requires it, errors are actionable, and no important failure is swallowed silently.

15. **Accessibility** — For changes to UI surfaces, verify dynamic / large text, screen reader labels and roles, focus order, contrast against the project palette, reduced-motion respect, color-independence, and keyboard / non-touch operability. Map to `WCAG 2.2 AA` and `EN 301 549` when materially relevant. Stack-specific a11y rules in `STACK.md` are hard requirements.

16. **AI / agent surfaces** — If the change adds LLM, retrieval, prompt, model-output, tool-call, or autonomous-agent behavior, check prompt-injection exposure, tool authorization boundaries, sensitive-data flow, output validation, evaluation coverage, audit logs, rate limits, and fail-closed behavior. Map to OWASP LLM Top 10 only when relevant.

## Finding format

Every blocking finding in the PR comment must use this format:

```md
### <Checklist item>: <short finding title>

- **Location:** `<file>:<line>`
- **Evidence:** <what the diff or surrounding code shows>
- **Impact:** <production risk or rule consequence>
- **Local rule:** `<VISION.md / AGENTS.md / STACK.md / CLAUDE.md section>`
- **External reference:** <official standard or docs URL when materially applicable, otherwise `N/A`>
- **Minimum fix:** <smallest change that resolves the issue>
- **Verification:** <test, check, preview, or command that proves the fix>
```

Do not include findings that cannot be tied to a concrete location, PR metadata item, or changed project artifact. For PR-level issues, use `PR description`, `branch history`, `CI checks`, or the GitHub issue the PR closes as the location.

## Output

Post every review as a plain PR comment. The PASS / FAIL verdict lives as the first line of the comment body.

```sh
gh pr review --comment --body "<comment>"
```

Do not use `--approve` or `--request-changes`: GitHub rejects those when the reviewer is also the PR author, which is the common case here. Plain comments work regardless of authorship and still produce a permanent audit-trail entry on the PR.

The comment body starts with one of:

- `**Verdict: PASS**` — every required check passed cleanly and no blocking findings exist.
- `**Verdict: FAIL**` — at least one blocking finding exists.

Then list every blocking finding with the required finding format. Group by checklist item.

If there are no blocking findings but an external fact could not be verified, add a short `Verification notes` section after the verdict. Do not turn uncertainty into a failure unless a local project rule requires explicit evidence and that evidence is missing.

**PASS means zero blocking findings across all checklist items plus privacy compliance.** Do not categorize PR findings as "nitpick", "minor", or "suggestion". Either the issue is a blocking finding with evidence, impact, rule, fix, and verification, or it is omitted from the merge-gate comment.

Every review round gets its own PR comment — including failed ones — so there is a permanent audit trail on GitHub.

Finally, report to the user in Finnish (Claude's chat replies are the only Finnish artifact — the PR comment itself is English):

- Verdict (PASS / FAIL).
- Number of blocking findings if FAIL.
- Link to the review comment on GitHub.
- For FAIL: suggest running `/codereview` again after fixing (the autonomous flow does this automatically — up to 3 review rounds before the issue is handed back to the human).

## Autonomy fallback

If a check is genuinely ambiguous and the local rules do not clearly resolve it, default to **FAIL only when merge would require accepting an unverified production, privacy, security, workflow, or correctness risk**. Otherwise omit the issue or record it as a verification note. Do not call `AskUserQuestion`.
