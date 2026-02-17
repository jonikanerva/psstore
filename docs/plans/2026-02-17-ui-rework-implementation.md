# UI Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken frontend navigation/search/list UI with a stable minimal shell using reusable game cards across PLP/search and a richer PDP layout with conditional media sections.

**Architecture:** Build a single `AppShell` route layout with sticky top navigation and global search, then route PLP/search/detail pages through shared fetch/state primitives. Replace image-only tile rendering with a compact `GameCard` grid and rebuild PDP presentation using the current `/api/games/:id` response.

**Tech Stack:** React 19, React Router, TypeScript, plain CSS modules per component, Vitest.

---

### Task 1: Add Frontend Route/App Shell Tests (red first)

**Files:**
- Create: `client/src/__tests__/app-shell.test.tsx`
- Modify: `client/package.json` (only if test setup script needs adjustment)

**Step 1: Write failing test for sticky shell + nav tabs + global search field**

```tsx
it('renders app shell with tabs and global search', async () => {
  render(<App />)
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /new/i })).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: /search games/i })).toBeInTheDocument()
})
```

**Step 2: Run test and verify failure**

Run: `npm run test -w client -- app-shell.test.tsx`
Expected: FAIL because shell/searchbox does not exist in current composition.

**Step 3: Commit**

```bash
git add client/src/__tests__/app-shell.test.tsx
git commit -m "test(client): add failing app shell rendering coverage"
```

### Task 2: Build `AppShell` and route layout

**Files:**
- Create: `client/src/components/AppShell.tsx`
- Create: `client/src/components/AppShell.css`
- Modify: `client/src/components/App.tsx`
- Modify: `client/src/components/Navigation.tsx`
- Modify: `client/src/components/Navigation.css`

**Step 1: Implement minimal shell**

```tsx
// AppShell.tsx
<header className="app-shell--header">...</header>
<main className="app-shell--main"><Outlet /></main>
```

**Step 2: Move nav tabs into sticky shell header**
- Keep tabs: `New`, `Upcoming`, `Discounted`, `Plus`.
- Remove separate `Search` tab.

**Step 3: Update router composition to nested routes under shell**
- Parent route renders `AppShell`.
- Child routes render PLP/search/detail pages.

**Step 4: Run tests**

Run: `npm run test -w client -- app-shell.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add client/src/components/App.tsx client/src/components/AppShell.tsx client/src/components/AppShell.css client/src/components/Navigation.tsx client/src/components/Navigation.css
git commit -m "feat(client): add sticky app shell and nested route layout"
```

### Task 3: Add global header search behavior

**Files:**
- Create: `client/src/components/HeaderSearch.tsx`
- Create: `client/src/components/HeaderSearch.css`
- Modify: `client/src/components/AppShell.tsx`
- Modify: `client/src/lib/search.ts`

**Step 1: Write failing behavior test**
- Add test in `client/src/__tests__/app-shell.test.tsx` verifying submit navigates to `/search?q=elden`.

**Step 2: Implement controlled search field in shell**
- Use router navigation on submit.
- Keep URL query as source of truth when on `/search`.

**Step 3: Keep parsing helper stable**
- Ensure `getSearchQuery` handles empty/missing `q` safely.

**Step 4: Run tests**

Run: `npm run test -w client -- app-shell.test.tsx search.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add client/src/components/HeaderSearch.tsx client/src/components/HeaderSearch.css client/src/components/AppShell.tsx client/src/lib/search.ts client/src/__tests__/app-shell.test.tsx
git commit -m "feat(client): wire global header search to /search route"
```

### Task 4: Replace image-only tile with reusable `GameCard`

**Files:**
- Create: `client/src/components/GameCard.tsx`
- Create: `client/src/components/GameCard.css`
- Modify: `client/src/components/Games.tsx`
- Remove or deprecate: `client/src/components/Game.tsx`, `client/src/components/Game.css`

**Step 1: Write failing component test**

Create `client/src/__tests__/game-card.test.tsx`:
```tsx
it('renders cover, name, genres, price and release date', () => {
  render(<GameCard game={mockGame} />)
  expect(screen.getByText(mockGame.name)).toBeInTheDocument()
  expect(screen.getByText(/Action/)).toBeInTheDocument()
  expect(screen.getByText(mockGame.price)).toBeInTheDocument()
  expect(screen.getByText(/Released/)).toBeInTheDocument()
})
```

**Step 2: Implement `GameCard`**
- Compact card density.
- Entire card links to `/g/:id`.

**Step 3: Replace mapping in `Games.tsx` to use `GameCard`**
- Remove date-header-first tile pattern.
- Render flat compact grid.

**Step 4: Run tests**

Run: `npm run test -w client -- game-card.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add client/src/components/GameCard.tsx client/src/components/GameCard.css client/src/components/Games.tsx client/src/__tests__/game-card.test.tsx client/src/components/Game.tsx client/src/components/Game.css
git commit -m "feat(client): introduce reusable compact game card for PLP and search"
```

### Task 5: Normalize PLP page structure and states

**Files:**
- Create: `client/src/components/GamesPage.tsx`
- Create: `client/src/components/GamesPage.css`
- Modify: `client/src/components/Games.tsx` (or replace with wrapper)
- Modify: `client/src/components/SearchResults.tsx`
- Modify: `client/src/components/Error.tsx` / `client/src/components/Spinner.tsx` if needed

**Step 1: Write failing test for non-empty layout states**
- Add test ensuring loading, error, and empty states each render with consistent container.

**Step 2: Implement page wrapper**
- Unified content spacing below sticky header.
- Optional genre filters for PLP routes.

**Step 3: Route search results through same page/card system**
- `/search` should use same card grid component.

**Step 4: Run tests**

Run: `npm run test -w client`
Expected: PASS for client suite.

**Step 5: Commit**

```bash
git add client/src/components/GamesPage.tsx client/src/components/GamesPage.css client/src/components/Games.tsx client/src/components/SearchResults.tsx client/src/__tests__
git commit -m "refactor(client): unify plp/search state rendering with shared page container"
```

### Task 6: Rebuild PDP layout with conditional media sections

**Files:**
- Create: `client/src/components/GameDetailsPage.tsx`
- Create: `client/src/components/GameDetailsPage.css`
- Modify: `client/src/components/Details.tsx`
- Modify: `client/src/components/Screenshots.tsx`
- Modify: `client/src/components/Screenshots.css`

**Step 1: Write failing PDP tests**
Create `client/src/__tests__/pdp.test.tsx`:
- renders metadata summary.
- hides description/screenshots/videos sections when data arrays are empty.

**Step 2: Implement PDP structure**
- summary block with cover + metadata
- description section only when `description` is present
- screenshots section only when `screenshots.length > 0`
- videos section only when `videos.length > 0`

**Step 3: Keep existing fetch path (`fetchGame`) and id route behavior**

**Step 4: Run tests**

Run: `npm run test -w client -- pdp.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add client/src/components/GameDetailsPage.tsx client/src/components/GameDetailsPage.css client/src/components/Details.tsx client/src/components/Screenshots.tsx client/src/components/Screenshots.css client/src/__tests__/pdp.test.tsx
git commit -m "feat(client): rebuild pdp with conditional detail/media sections"
```

### Task 7: Compact responsive CSS and accessibility pass

**Files:**
- Modify: `client/src/components/App.css`
- Modify: `client/src/components/AppShell.css`
- Modify: `client/src/components/Navigation.css`
- Modify: `client/src/components/GameCard.css`
- Modify: `client/src/components/GamesPage.css`

**Step 1: Add/normalize CSS variables for spacing, typography, and borders**

**Step 2: Apply compact responsive breakpoints**
- mobile: 2 columns
- tablet: 3 columns
- desktop: 4+ columns

**Step 3: Add explicit focus-visible styles**
- nav links
- card links
- search controls
- filter buttons

**Step 4: Run lint/build checks for client**

Run:
- `npm run lint -w client`
- `npm run typecheck -w client`
- `npm run build -w client`

Expected: all PASS.

**Step 5: Commit**

```bash
git add client/src/components/App.css client/src/components/AppShell.css client/src/components/Navigation.css client/src/components/GameCard.css client/src/components/GamesPage.css
git commit -m "style(client): apply compact accessible catalog styling"
```

### Task 8: Update docs and run full repo quality gates

**Files:**
- Modify: `readme.md`
- Modify: `AGENTS.md` only if command expectations need updating

**Step 1: Update README frontend behavior summary**
- sticky shell nav
- global search behavior
- shared game card + PDP section behavior

**Step 2: Run full required gates**

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run sony:validate`
- `npm run sony:diff -- --ci`

Expected: all PASS.

**Step 3: Commit**

```bash
git add readme.md AGENTS.md
git commit -m "docs: describe new ui shell, cards, and pdp behavior"
```

### Task 9: Final verification and smoke checklist

**Files:**
- No code changes expected

**Step 1: Local smoke checks**
- `/new` renders sticky header + compact cards with metadata.
- tab navigation works for `/upcoming`, `/discounted`, `/plus`.
- global search submits to `/search?q=...` and renders cards.
- clicking a card opens `/g/:id`.
- PDP hides missing sections correctly.

**Step 2: Record verification output in PR notes or completion summary**

**Step 3: Final commit (if any tiny fix from smoke)**

```bash
git add <touched-files>
git commit -m "fix(client): address final ui smoke issues"
```
