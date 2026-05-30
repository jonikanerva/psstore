# AGENTS.md

> Operating contract for Claude Code working on this project.
> Read `VISION.md` first, then this file, then `STACK.md`, then `README.md`.
> Treat every rule below as **MUST** unless explicitly marked otherwise. When a rule conflicts with a user request, surface the conflict — do not silently break the rule. Propose the smallest framework-native alternative and explain the tradeoff.

---

## 0. Mission

Build the product described in `VISION.md`, on the technology stack declared in `STACK.md`.

The codebase must be:

1. **Framework-native.** Use the platform's current standard library, frameworks, and idioms first. No back-deployment to retired versions, no compatibility shims for languages or runtimes the project does not support.
2. **Responsive under failure/load.** The UI / API stays usable under slow networks, denied permissions, missing data, degraded sensors, heavy decoding, or background sync.
3. **Strict typing and concurrency.** Strictest available compiler / linter mode, full type-checking, no warnings allowed in shipped code, no concurrency races.
4. **Resource-conscious.** Profile before optimizing, but stay inside the budgets declared in `STACK.md` (frame time, p99 latency, memory, battery if relevant).
5. **Privacy-respecting by construction.** Collect only what the product genuinely needs. No silent telemetry. No third-party analytics by default.
6. **Easy to evolve.** No custom application frameworks, no architecture astronautics, no third-party ceremony.

When a newer language / framework feature supersedes an older one, prefer the new one. Examples: structured concurrency over callbacks, value types over inheritance hierarchies, declarative UI over imperative DOM/UIKit manipulation.

---

## 0.1 Product guardrails (from `VISION.md`)

`VISION.md` defines the product's core principles, non-goals, and decision filter. Read it before evaluating any feature.

**Before accepting a feature, run the VISION decision filter** — the four questions defined in `VISION.md → Decision Filter`. If the answer to any of these is "no", **reject the feature**. Document the rejection in the PR description (or, if no PR exists yet, on the issue / discussion that proposed the feature) — that is the audit trail. If the rejection establishes a binding constraint that future agents must respect (e.g. "no feature in category X without re-running the filter"), record it in the PR description and, when it is technical and durable, in `STACK.md → Intentional Divergences`. Do not silently violate `VISION.md`.

The decision filter is product-specific; agents read it dynamically from `VISION.md` and do not hard-code its contents.

---

## 1. Non-negotiables

- Use the platform's standard library and first-party frameworks first. No third-party runtime dependencies without an entry in `STACK.md → Approved Dependencies`.
- The framework declared in `STACK.md` is the default UI / API layer. Use lower-level primitives only to wrap a missing capability, and isolate them behind a thin adapter.
- Strictest compiler / linter / type-check mode allowed by `STACK.md`. No new warnings. No relaxed-mode escape hatches without an inline justification.
- The UI thread / event loop is for UI work only. Never block it with network, disk, parsing, image decoding/resizing, crypto, sorting, mapping, or waiting.
- Offline, denied-permission, degraded-data, and failure paths are first-class UX states.
- Prefer standard, framework-native components, navigation, and styling. No custom chrome when standard components solve the problem.
- **Avoid architecture astronautics.** No custom app frameworks, god objects, service locators, base-view-model hierarchies, generic reducer systems, or dependency-injection containers unless explicitly authorised in `STACK.md`. _(This project authorises Effect's `Layer` as its DI mechanism and Effect as its effect runtime — see `STACK.md → Approved dependencies` and the DI guardrail there. The authorisation is bounded: no second DI system or home-grown framework on top of Effect.)_
- **Never persist or transmit user data the product does not require.** Persistence rules are defined per project in `STACK.md` and `VISION.md`.

---

## 2. Default stack

The concrete stack — language, runtime, frameworks, build commands, formatter, linter, test runner, performance budgets, persistence shape, logging, telemetry — is declared in **`STACK.md`**. Agents consult that file for technology choices.

Universal rules in this file (architecture, concurrency, UI responsiveness, side-effects discipline, privacy, testing strategy, dependencies, code conventions, reject list) apply on top of whatever stack is chosen.

---

## 3. Architecture

### 3.1 Overall shape

Simple layered architecture:

1. **Presentation** — views, components, screens, presentation models. Whatever surfaces the framework offers (e.g. SwiftUI views, React components, HTTP handlers).
2. **Domain / application** — pure transforms, state machines, intents, business rules. No framework imports beyond the standard library.
3. **Infrastructure** — network, storage, sensors, third-party adapters. Vended via narrow protocols / interfaces; never reached for directly from presentation code.

Views / handlers do not talk directly to low-level system managers or raw network calls. Domain code is pure and easy to test.

### 3.2 Do not force ViewModel-per-view (or Service-per-handler)

Do not create a separate `ViewModel` / `Controller` / `Service` for every tiny unit of UI. Use this decision table:

| Need                                          | Default                                         | Why                                         |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| Tiny view-local UI state                      | local state primitive (`@State`, `useState`, …) | Owned by the view                           |
| Shared screen/feature state with side effects | one observable state holder per screen          | Clear UI ownership, granular updates        |
| Shared mutable non-UI state                   | thread-safe primitive (`actor`, mutex, queue)   | Data-race safety                            |
| App-wide dependency                           | initializer / context / environment injection   | Explicit dependency flow                    |
| Durable local data                            | the persistence layer declared in `STACK.md`    | Survives cold launches; one source of truth |
| Ephemeral expensive cache                     | in-memory cache primitive                       | Avoid recomputation and hitching            |
| Streaming live feed                           | `AsyncSequence` / async iterator from a service | Cooperative, cancellable                    |

Name presentation models by responsibility (`HomeModel`, `CheckoutController`), not by mechanical suffix (`HomeViewModel`, `CheckoutPagePresenter`).

### 3.3 Presentation model rules

A presentation model:

- is isolated to the UI thread / event loop
- owns screen state and exposes user intents as methods
- calls services via `async` methods or consumes their async streams
- performs no heavy work on the UI thread
- does not expose raw framework delegates or storage internals to views
- models UI phases as **tagged unions / enums with associated values**, not parallel booleans

The point is one obvious state owner per screen, explicit phases, heavy work behind a service boundary, UI updates on the UI thread, no parallel booleans, no hidden mutable globals.

---

## 4. Concurrency (non-negotiable)

| Rule | Detail                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1   | The strictest concurrency / async-safety mode declared in `STACK.md` is enabled. No new warnings, no relaxed-mode escapes.                                                                             |
| C2   | UI-facing state holders are isolated to the UI thread / event loop. Annotate explicitly; do not rely on inference where the language allows both.                                                      |
| C3   | Shared mutable non-UI state lives behind a thread-safe primitive (`actor`, mutex, channel, queue). Services expose `async` methods or async streams.                                                   |
| C4   | Prefer **structured concurrency**: scoped tasks, `async let`, task groups, `for await`. The lifetime of async work matches a concrete scope.                                                           |
| C5   | Use unstructured / detached background work only when it must outlive the calling scope, with an inline comment explaining why.                                                                        |
| C6   | Avoid detached privilege-escalation primitives unless the isolation requirement is documented in an inline comment.                                                                                    |
| C7   | **Cancellation is mandatory.** Long-running streams cooperate with cancellation. When a view disappears, its subscriptions stop.                                                                       |
| C8   | Types crossing concurrency boundaries are thread-safe (Sendable / immutable / serialisable). Unsafe-marker overrides require an inline justification.                                                  |
| C9   | Cross-actor / cross-thread data uses value types or immutable references. Never pass mutable reference graphs across concurrency boundaries.                                                           |
| C10  | UI-thread functions awaiting `async` work MUST NOT block. No semaphore.wait, no busy loops, no sync-over-async bridges.                                                                                |
| C11  | Use lower-level concurrency primitives (`DispatchQueue`, raw threads, raw event-loop tricks) only when an underlying API requires it. Bridge to `AsyncSequence` / async iterator immediately.          |
| C12  | Reactive / publisher frameworks are allowed only at framework boundaries that still vend them. Convert to `async` streams immediately.                                                                 |
| C13  | Concurrency-warning silencers (`@unchecked Sendable`, `nonisolated(unsafe)`, `@preconcurrency`, equivalent escape hatches) are last-resort tools. Prefer fixing isolation over silencing the compiler. |

---

## 5. UI / API responsiveness (the hard rule)

Every code path triggered from a view / request handler MUST satisfy all of:

1. The synchronous portion stays inside the budget declared in `STACK.md` (e.g. one display frame for UI, p99 per-request budget for an API).
2. Anything slower runs `await`-style on a background actor / worker. The UI shows a deterministic placeholder or last-known-good value while waiting; an API streams or paginates.
3. Network, sensor, and external-system calls have explicit timeouts and graceful fallbacks — they NEVER leave the user staring at a spinner forever.
4. Lists / large collections render lazily (virtualised lists, `LazyVStack` / `FlatList` / windowed table) with stable identifiers.
5. Image / asset / icon loading goes through a framework-native async loader or a thread-safe cache. Never block the UI thread for I/O.
6. Hot paths (per-frame math, per-request hot loops) are branch-light and allocation-light. No formatter / parser construction in the hot path — pre-build them on the model / handler.
7. No expensive work in render functions, view builders, computed properties, or middleware that runs on every event. Cache derived results when recomputation would cause hitches.
8. Navigation and input handling never wait for network or storage completion.
9. **Prefer continuity over blankness.** If the last known state is useful, show it (marked stale) and refresh around it.

### 5.1 UI states that must be handled explicitly

Every user-visible surface handles, when applicable, the states declared by the product (`VISION.md`) and the stack (`STACK.md`). Common universals: **loading / awaiting first data, success, empty, degraded, permission-blocked, offline, error**. The concrete enumeration for this project lives next to the screen definition; previews / stories must exercise each state.

---

## 6. Side effects

### 6.1 Networking

- Use the framework-native async client declared in `STACK.md` _(this project: `@effect/platform` `HttpClient` / HttpApi, behind the thin adapter — see `STACK.md §2`, §13)_. Configure timeouts, retries, and connectivity expectations once per service.
- Request construction, decoding, retries, and backoff live in the service layer. Views / handlers never build raw requests or decode payloads inline. External data is decoded and narrowed via Effect `Schema` at the boundary before it reaches any other code.
- Per-feature typed error enum / class _(this project: tagged errors in the Effect `E` channel; no `throw` in domain logic — see `STACK.md §0`)_. UI never sees raw transport-level error codes.

### 6.2 Persistence

- The persistence shape (key-value, document store, SQL, file system, none) is declared in `STACK.md`.
- **Never persist data the product does not require.** If a feature request implies storing data the product has not authorised, reject it per §0.1.
- Decoding / migration failures are handled gracefully (safe re-init, schema bump path) rather than crashes.
- Avoid write-heavy loops on hot UI / request paths.

### 6.3 External systems & sensors

- Whenever the project consumes a side-effecting external system (sensors, biometrics, cameras, payment processors, third-party APIs), wrap it behind a service boundary.
- Lifecycle: start when needed, stop when no longer needed (view disappears, request completes, app backgrounds without an active long-running activity).
- Permissions: request the narrowest scope; escalate only when justified by a feature in `VISION.md`.
- Degradation: every external dependency has explicit degraded / unavailable phases that the UI / API surfaces.
- Background behaviour: the project's expectation about background work is documented in `STACK.md`. Anything beyond it is rejected per §13.

### 6.4 Caching

- Use framework-native HTTP / asset caches when available.
- Long-lived in-memory caches sit behind a thread-safe primitive.
- Never cache PII or auth tokens beyond their authorised lifetime.

---

## 7. Resource budget

Profile before optimising — but stay inside the budgets declared in `STACK.md` (frame time, p99 API latency, memory, battery, bundle size). Common rules:

- **Hot signal sources** (per-frame, per-request) are the highest-frequency work. Throttle / batch updates at the model / service, not in the view / handler.
- **Background / always-on modes** must avoid continuous animation, polling, or networking when the user is not actively engaged. Pause work when the surface is inactive.
- **External API calls during the hot path** (e.g. networking during a journey, blocking writes during render) are forbidden by default. Cache, prefetch, or move them off the hot path.
- **Bundled measurement**: profile any change that touches the hot path with the tooling declared in `STACK.md` before merging.

---

## 8. Privacy & security

- Maintain whatever privacy declaration the platform requires (`PrivacyInfo.xcprivacy`, GDPR data-flow inventory, …) accurately. Every required-reason API call is declared.
- **Never log PII or coordinate-derived values to a persistent store or log sink.** Use the platform's privacy-aware interpolation (e.g. Swift `os.Logger` `.private`, structured loggers with redaction filters). In release builds the substituted value must not leak PII.
- No silent telemetry. No third-party analytics by default.
- HTTPS / TLS only. No arbitrary-load escape hatches.
- Secrets never live in the repo. Configuration via environment variables / config files outside source control. Add to `.gitignore`.

---

## 9. Testing

- Use the test framework declared in `STACK.md`. All tests run clean under the strictest concurrency / type-check mode.
- **Test the pure domain code first**: transforms, state-machine transitions, edge cases. These are the highest-value tests.
- Test the state holder that drives a view / handler, not the view / handler itself. Drive it with a fake / in-memory implementation of the service boundary and assert the resulting timeline.
- Prefer protocol-backed services with `Live` / `Preview` / `Fake` implementations over heavyweight mocking frameworks _(this project: Effect `Layer`s — test runs provide fake Sony-client + cache `Layer`s; time-dependent logic uses `TestClock`; see `STACK.md §11`)_.
- Profiling / load testing for performance-sensitive features uses the tooling declared in `STACK.md`.

---

## 10. Code conventions

- Prefer value types (`struct`, `record`, plain object) by default; use reference / class types when identity or shared mutation is required.
- Prefer composition over inheritance. Avoid open class hierarchies.
- Small, explicit, purpose-driven types. File names align with the primary type they define.
- Prefer immutable bindings (`let`, `const`, `final`) over mutable ones (`var`, `let mut`).
- No force-unwraps / non-null assertions / `as` coercions outside tests and previews. Use proper error propagation.
- No broad type erasure (`AnyView`, `any`, `unknown` cast, reflection tricks) unless there is a clear measured benefit.
- Avoid global mutable state and singletons unless an underlying API essentially requires one.
- Delete dead code; do not comment it out.
- Comments explain _why_, invariants, or tradeoffs — not obvious line-by-line behaviour.
- Public API / exported symbols get a doc comment.
- Hot-path domain functions are pure, allocation-light, and inline-friendly where the language supports it.
- Feature flags live in a single typed configuration object, not scattered.
- No `print` / `console.log` / `dump` in shipped code; use the structured logger declared in `STACK.md`. Never log values that could leak PII.
- Run `STACK.md → $FORMAT_CMD` before committing. The build / format / lint / test commands declared in `STACK.md` are the single source of truth — never invoke the underlying tools (`swift-format`, `xcodebuild`, `eslint`, `tsc`, etc.) directly from commits or agent scripts.

---

## 11. Dependencies

- Default answer to "should we add a library?" is **no**.
- Banned by category: UI frameworks competing with the chosen one, state-management frameworks, DI containers, reactive frameworks where structured concurrency suffices, navigation libraries the platform already covers, networking wrappers, JSON libraries, analytics libraries, crash reporters bundled by default. _(Exceptions authorised in `STACK.md → Approved dependencies`: Effect's `Layer` (DI) and Effect itself (structured concurrency, not a reactive framework); TanStack Query (client cache) and TanStack Router (routing). The category bans stand for everything not explicitly listed there.)_
- If a dependency is genuinely needed:
  - Must use the platform's package manager declared in `STACK.md` (`SwiftPM`, `pnpm`, `cargo`, …).
  - Must compile clean under the strictest concurrency / type-check mode.
  - Must be added to `STACK.md → Approved Dependencies` with rationale, approver, and date.

---

## 12. Build & verification

- Use the build tool, language version, and lock-file declared in `STACK.md`. Strictness flags are non-negotiable in every target.
- The single source of truth for verify / lint / build / test commands is `STACK.md`. Every agent runs the named commands (`$VERIFY_CMD`, `$FORMAT_CMD`, `$LINT_CMD`, `$TEST_CMD`, `$BUILD_CMD`) — never raw tool invocations.
- `$VERIFY_CMD` is the mandatory local gate before every commit and every PR:
  ```sh
  $VERIFY_CMD
  ```
  It MUST pass without warnings. There is no remote gate that substitutes for it.
- Previews / stories for every non-trivial UI surface, at least one per state listed in `VISION.md` / the screen-local state enumeration.
- `.gitignore` excludes build artefacts, derived data, dependency caches, and editor / OS noise.

---

## 13. Reject changes that…

Reject or redesign any change that:

**Product-level (from `VISION.md`):**

- violates any of the four `VISION.md → Decision Filter` questions,
- adds a feature listed in `VISION.md → Non-Goals`,
- expands the live / core mode beyond what `VISION.md` permits,
- increases expected screen time / friction / cognitive load contrary to `VISION.md → Core Principles`.

**Technical (universal):**

- adds a competing UI / state framework where the chosen one suffices,
- introduces classic ViewModel / Service / Controller boilerplate where a smaller state holder would do,
- puts heavy work in render functions, view builders, or middleware that runs on every event,
- couples views directly to network, storage, sensors, or persistence internals,
- hides failure behind infinite spinners,
- introduces duplicated mutable state without a clear single source of truth,
- uses parallel boolean flags instead of a typed state machine,
- suppresses concurrency / type warnings with escape hatches instead of fixing isolation,
- spawns fire-and-forget async work with no ownership or cancellation model,
- adds main-thread dispatch "to fix a warning",
- adds a non-first-party dependency for a problem the platform already solves,
- lowers the minimum runtime / language version declared in `STACK.md`,
- introduces `print` / `console.log`, `fatalError("TODO")`, commented-out code, or any logging of PII,
- adds singletons, service locators, or DI containers without explicit approval in `STACK.md`,
- violates any stack-specific rule listed in `STACK.md → Stack-specific reject-list additions`.

---

## 14. Agent workflow

When implementing a change:

1. Read `VISION.md`, this file, `STACK.md`, and the GitHub issue scoping this work (the issue body is the task description). State which rules are relevant.
2. Run the §0.1 VISION decision filter for any feature change.
3. Identify the feature boundary and which §3.1 layer the change lives in.
4. Preserve or improve explicit state ownership.
5. Keep heavy work off the UI thread.
6. Keep async work cancellable.
7. Prefer the smallest framework-native solution that fits.
8. **Before writing or editing any code that uses an approved dependency, retrieve its version-pinned docs via Context7** per `STACK.md → Documentation protocol`. Never write library code from memory (Effect priors in particular drift to v2 / v4-beta). Ground the glue *between* packages, not just each call.
9. Run `$FORMAT_CMD` then `$VERIFY_CMD`. Never invoke underlying tools directly.
10. Update previews / stories / fixtures if UI surfaces changed.
11. Update tests for logic changes.
12. Update `STACK.md` if approved dependencies or build commands changed.
13. Summarise in the PR description: _what changed, which `AGENTS.md` / `STACK.md` rules apply, what was tested, any new states handled, the §0.1 decision-filter outcome, and the Context7 docs grounded (per `STACK.md → Documentation protocol`)._

### 14.1 Autonomy fallback (single source of truth)

When a decision is genuinely ambiguous and the answer is not derivable from `VISION.md`, `STACK.md`, this file, or any open GitHub issue scoping the work:

1. Pick the smallest-surface, most-conservative interpretation that satisfies the §0.1 decision filter.
2. Document the choice **in the PR description** — the alternatives considered and the rationale. The PR description (preserved by the merge commit on `main`) is the audit trail. If the choice introduces a binding constraint that future agents must respect, also record it in `STACK.md → Intentional Divergences` when it is technical and durable.
3. Proceed.

Do not call `AskUserQuestion`. Do not pause for human input. The exception is direct edits to `VISION.md` or `AGENTS.md` themselves — those require an explicit user request, because they are the foundation other decisions rest on.

If `$VERIFY_CMD` keeps failing despite up to **10 fix attempts**, do not loop indefinitely. Create a `chore/abandoned-<task>` branch with the work-in-progress, push it, open a draft PR (or comment on the existing PR) describing the failure mode and what was tried, and stop. The PR / branch on GitHub is the audit trail.

If a requested change conflicts with this file, `VISION.md`, or `STACK.md`, propose the smallest framework-native alternative and document the conflict in the PR description — do not silently violate the rule.

---

## 15. Definition of done

A change is not done unless:

- the UI / API stays responsive under slow network, denied permissions, degraded data, backgrounding, and CPU load,
- all relevant states declared by the product / stack are handled explicitly (loading / success / empty / degraded / permission-blocked / offline / error, plus product-specific ones),
- no heavy work remains on the UI thread,
- every async path is cancellation-safe,
- no new persisted or transmitted data violates `VISION.md` or `STACK.md`,
- tests cover new core logic and run clean under the strictest concurrency / type-check mode,
- the stack-specific done criteria in `STACK.md → Definition of done (stack additions)` also hold (no I/O in the pure core, no `throw` in domain logic, every Schema decoder has narrowing + price-mapping tests, new library usage grounded in Context7),
- accessibility (Dynamic Type / large text, screen reader, reduced motion, contrast, dark mode) was considered,
- `$VERIFY_CMD` passes without warnings,
- privacy declarations are updated if new data flows were introduced,
- new code follows the rules above,
- docs (`STACK.md`, `README.md`) are updated when the design changes.

---

## 16. When to intentionally diverge

Divergence from this file is valid, but deliberate. Acceptable reasons:

- a missing framework capability that genuinely requires a lower-level adapter,
- a proven persistence requirement the default storage shape does not fit,
- a specific performance bottleneck proven by measurement,
- a platform / framework integration that only exposes an older API shape.

Bar: **measurable need, clear benefit, isolated exception, documented reason.** Record the divergence in `STACK.md → Intentional Divergences`. Divergence from `VISION.md` is **not** covered by this section — it requires the human product owner.

---

## 17. Short version

If you are unsure what to do, optimise in this order:

1. **Honour `VISION.md`.** The product's principles win over technical taste.
2. **Keep the UI / API responsive.** The hot path is sacred.
3. **Use framework-native primitives and current platform patterns.** No reinvented wheels.
4. **Respect the user's resources and privacy.** Minimum data, minimum battery, minimum noise.
5. **Prefer simple, testable, data-driven code.** Explicit state machines over parallel booleans.
6. **Avoid cleverness, unnecessary abstractions, and dependency creep.**
