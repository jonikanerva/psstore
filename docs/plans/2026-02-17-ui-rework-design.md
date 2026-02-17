# PS Store UI Rework Design

## Summary
Rebuild the frontend UI into a minimal utilitarian catalog that fixes broken top-level navigation and search UX while keeping existing backend endpoints.

## Product Decisions (Approved)
- Visual direction: minimal utilitarian catalog.
- Search placement: global search input in sticky top bar (not a separate nav tab).
- Card density: compact layout.
- PDP missing fields: hide empty sections (no placeholders).

## Goals
- Fix top-level navigation and search flow.
- Replace image-only tiles with reusable game cards showing:
  - cover image
  - game name
  - genres
  - price
  - release date
- Use the same card component across PLP routes.
- Keep PDP route with richer details, screenshots, and videos.

## Non-Goals
- Backend API contract changes.
- Full visual branding redesign.
- New feature tabs beyond existing route set.

## Approaches Considered

### 1) Single-shell app layout + reusable `GameCard` (Selected)
- One persistent app shell with sticky nav and global search.
- PLP routes render into shared page structure and reusable list/card components.
- PDP remains a route in same shell.

Trade-offs:
- Pros: consistent UX, less duplication, easier long-term maintenance.
- Cons: medium refactor across routing/layout files.

### 2) Route-local layout per page
- Each route owns its own nav/search/list UI.

Trade-offs:
- Pros: smaller immediate code changes.
- Cons: duplicate logic, inconsistent behavior, regression risk.

### 3) Config-driven page renderer
- Abstract route behavior into a large configuration layer.

Trade-offs:
- Pros: high flexibility.
- Cons: over-engineered for current scope.

## Information Architecture

### Primary routes
- `/new`
- `/upcoming`
- `/discounted`
- `/plus`
- `/search?q=...`
- `/g/:gameId`
- unknown routes -> redirect to `/new`

### Header behavior
- Sticky top header with:
  - app title
  - top navigation tabs (`New`, `Upcoming`, `Discounted`, `Plus`)
  - global search form
- Search submits to `/search?q=...`.

## Component Design

### `AppShell`
Responsibilities:
- render sticky header
- host top nav links
- host global search input
- render route outlet content

### `GameCard` (shared PLP/search card)
Fields rendered:
- cover image
- title (line clamp)
- genres (line clamp)
- price
- release date

Behavior:
- entire card clickable to `/g/:id`.

### `GameGrid`
Responsibilities:
- render compact responsive grid of `GameCard`
- render loading, error, and empty states consistently
- optional genre filter chips for PLPs

### `GameDetailsPage` (PDP)
Sections:
- summary block (cover + title + metadata)
- long description (if available)
- screenshots gallery (if non-empty)
- videos gallery (if non-empty)

Rule:
- hide empty sections.

## Layout and Styling
- Keep plain CSS (no framework).
- Introduce clear CSS variables for spacing/surfaces/borders/text.
- Compact density target:
  - mobile: 2-column cards
  - tablet: 3-column cards
  - desktop: 4+ columns
- Maintain sticky header spacing with predictable top padding in content area.

## Data Flow
- Keep existing client API module (`/api/*`) and route fetchers.
- PLP/search pages fetch data route-by-route.
- Header search input controls URL query state.
- Search page reads `q` from URL and fetches matching games.

## Error and Empty State Strategy
- Loading: unified skeleton/spinner within content area.
- Error: page-level message + retry action.
- Empty:
  - tab pages: "No games found for this tab"
  - search: "No games found for '<query>'"

## Accessibility Baseline
- semantic landmarks (`header`, `nav`, `main`).
- visible keyboard focus styles on nav, cards, filters, and search controls.
- labeled search input and submit button.

## Testing Scope
- Route-level render test for each primary PLP route.
- Search flow test: header submit updates URL and results route renders.
- Card render test: verifies title/genre/price/date shown.
- PDP test: sections render only when data exists.

## Risks and Mitigations
- Risk: regressions from moving nav/search into shared shell.
  - Mitigation: route smoke tests and incremental component migration.
- Risk: visual regressions from CSS consolidation.
  - Mitigation: migrate styles component-by-component, preserve selectors until replacement is complete.

## Rollout
1. Introduce `AppShell` and migrate routing.
2. Add `GameCard` and replace old tile rendering.
3. Integrate global search in header and update `/search` behavior.
4. Rebuild PDP layout with conditional media sections.
5. Run full quality gates and route smoke checks.
