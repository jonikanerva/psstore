# PDP Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix missing data (publisher, description, genres) on the PDP, fix the broken Metacritic URL, and reorder the layout so media is prominent and description is secondary.

**Architecture:** Server-side enrichment adds `publisherName` from Sony's product detail API. Client reorders sections and fixes the Metacritic link format.

**Tech Stack:** React 19, Vite, Vitest, Express, TypeScript

---

### Task 1: Add publisherName to server product detail extraction

**Files:**
- Modify: `server/src/sony/sonyClient.ts:82-97`
- Test: `server/src/__tests__/sonyClient.test.ts`

**Step 1: Write the failing test**

Add to `server/src/__tests__/sonyClient.test.ts` inside the `extractProductDetail` describe block:

```typescript
it('extracts publisherName from product detail', () => {
  const result = extractProductDetail({
    data: {
      productRetrieve: {
        id: 'UP4139-PPSA27597_00-STELLARDELUXEPS5',
        releaseDate: '2025-11-11T00:00:00Z',
        genres: ['Strategy'],
        longDescription: '<p>Grand strategy</p>',
        publisherName: 'PARADOX GAMES INC',
      },
    },
  })

  expect(result.publisherName).toBe('PARADOX GAMES INC')
})

it('returns undefined publisherName when missing', () => {
  const result = extractProductDetail({
    data: { productRetrieve: { id: 'test' } },
  })

  expect(result.publisherName).toBeUndefined()
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -w server -- --run sonyClient`
Expected: FAIL — `publisherName` is not in `ProductDetailResult`

**Step 3: Write minimal implementation**

In `server/src/sony/sonyClient.ts`, update `ProductDetailResult` and `extractProductDetail`:

```typescript
export interface ProductDetailResult {
  releaseDate?: string
  genres: string[]
  description: string
  publisherName?: string
}

export const extractProductDetail = (json: ProductRetrieveResponse): ProductDetailResult => {
  const product = json.data?.productRetrieve
  const releaseDate = typeof product?.releaseDate === 'string' && product.releaseDate.length > 0
    ? product.releaseDate
    : undefined
  const genres = product?.genres ?? []
  const description = product?.longDescription ?? product?.description ?? ''
  const publisherName = typeof product?.publisherName === 'string' && product.publisherName.length > 0
    ? product.publisherName
    : undefined

  return { releaseDate, genres, description, publisherName }
}
```

Also add `publisherName` to the `ProductDetail` interface in `server/src/sony/types.ts`:

```typescript
export interface ProductDetail {
  id?: string
  releaseDate?: string
  publisherName?: string
  genres?: string[]
  description?: string
  longDescription?: string
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -w server -- --run sonyClient`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/sony/sonyClient.ts server/src/sony/types.ts server/src/__tests__/sonyClient.test.ts
git commit -m "feat: extract publisherName from product detail API"
```

---

### Task 2: Map publisherName to studio in game enrichment

**Files:**
- Modify: `server/src/services/gamesService.ts:165-178`
- Test: `server/src/__tests__/gamesService.test.ts`

**Step 1: Write the failing test**

Add to `server/src/__tests__/gamesService.test.ts`:

```typescript
it('enriches game with publisher name from product detail', async () => {
  fetchProductDetail.mockImplementation(async () => ({
    releaseDate: PAST_DATE,
    genres: ['Strategy'],
    description: '<p>Grand strategy</p>',
    publisherName: 'PARADOX GAMES INC',
  }))

  const svc = await import('../services/gamesService.js')
  const game = await svc.getGameById(
    (await svc.getNewGames()).games[0].id,
  )

  expect(game.studio).toBe('PARADOX GAMES INC')
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -w server -- --run gamesService`
Expected: FAIL — studio will still be empty because `enrichGameWithDetail` doesn't map it

**Step 3: Write minimal implementation**

In `server/src/services/gamesService.ts`, update `enrichGameWithDetail`:

```typescript
const enrichGameWithDetail = async (game: Game): Promise<Game> => {
  try {
    const detail = await fetchProductDetail(game.id)
    return {
      ...game,
      date: detail.releaseDate ?? game.date,
      genres: detail.genres.length > 0 ? detail.genres : game.genres,
      description: detail.description || game.description,
      studio: detail.publisherName || game.studio,
    }
  } catch (error) {
    console.warn(`Product detail enrichment failed for ${game.id}`, error)
    return game
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -w server -- --run gamesService`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/gamesService.ts server/src/__tests__/gamesService.test.ts
git commit -m "feat: map publisherName to studio during game enrichment"
```

---

### Task 3: Fix Metacritic URL

**Files:**
- Modify: `client/src/modules/psnStore.ts:25-28`
- Test: `client/src/__tests__/GameDetailsPage.test.tsx:27` (update mock)

**Step 1: Update the implementation**

In `client/src/modules/psnStore.ts`, replace the `metacriticLink` function:

```typescript
export const metacriticLink = (name: string): string =>
  `https://www.metacritic.com/search/${encodeURIComponent(name)}/`
```

**Step 2: Update the test mock to match new URL format**

In `client/src/__tests__/GameDetailsPage.test.tsx`, update the mock:

```typescript
vi.mock('../modules/psnStore', () => ({
  fetchGame: vi.fn(),
  metacriticLink: (name: string) => `https://www.metacritic.com/search/${encodeURIComponent(name)}/`,
}))
```

**Step 3: Run tests**

Run: `npm test -w client`
Expected: PASS

**Step 4: Commit**

```bash
git add client/src/modules/psnStore.ts client/src/__tests__/GameDetailsPage.test.tsx
git commit -m "fix: update Metacritic URL to current search format"
```

---

### Task 4: Reorder PDP layout and improve key info display

**Files:**
- Modify: `client/src/components/GameDetailsPage.tsx`
- Modify: `client/src/components/GameDetailsPage.css`
- Test: `client/src/__tests__/GameDetailsPage.test.tsx`

**Step 1: Update GameDetailsPage.tsx layout**

Reorder sections: key info -> media -> description. Also hide empty fields instead of showing placeholders.

```tsx
return (
  <article className="details-page">
    <section className="details-page--summary">
      <div className="details-page--cover">
        <Image url={game.url} name={game.name} />
      </div>
      <div className="details-page--info">
        <h1 className="details-page--title">{game.name}</h1>
        <dl className="details-page--meta-list">
          {game.price && (
            <>
              <dt>Price</dt>
              <dd>{game.price}</dd>
            </>
          )}
          <dt>Release</dt>
          <dd>{formatDate(game.date)}</dd>
          {game.studio && (
            <>
              <dt>Publisher</dt>
              <dd>{game.studio}</dd>
            </>
          )}
          {game.genres.length > 0 && (
            <>
              <dt>Genre</dt>
              <dd>{game.genres.join(', ')}</dd>
            </>
          )}
        </dl>
        <div className="details-page--actions">
          <a className="details-page--link" href={storeUrl(game.id)}>
            Open In Store
          </a>
          <a className="details-page--link" href={metacriticLink(game.name)}>
            Metacritic
          </a>
        </div>
      </div>
    </section>

    {(hasScreenshots || hasVideos) && (
      <section className="details-page--section">
        <h2>Media</h2>
        <div className="details-page--media-grid">
          {game.screenshots.map((screenshot) => (
            <div key={screenshot} className="details-page--media-item">
              <Image url={screenshot} name={game.name} />
            </div>
          ))}
          {game.videos.map((video) => (
            <video
              key={video}
              className="details-page--video"
              controls
              muted
              preload="metadata"
              src={video}
            />
          ))}
        </div>
      </section>
    )}

    {hasDescription && (
      <section className="details-page--section">
        <h2>Description</h2>
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(game.description) }} />
      </section>
    )}
  </article>
)
```

**Step 2: Add CSS for the definition list**

Add to `client/src/components/GameDetailsPage.css`:

```css
.details-page--meta-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
}

.details-page--meta-list dt {
  color: var(--muted-text-color);
}

.details-page--meta-list dd {
  margin: 0;
}
```

Remove the `.details-page--meta` rule since it's no longer used.

**Step 3: Update tests**

Update `client/src/__tests__/GameDetailsPage.test.tsx` to match new structure:

- The test checking for `RPG Studio` via `/RPG Studio/` should still pass since the text is still rendered.
- The test checking `screen.getByText(/49,99 €/)` should still pass.
- Update the test for "Screenshots" section heading — it's now "Media":

```typescript
it('renders media section only when screenshots or videos exist', async () => {
  const { fetchGame } = await import('../modules/psnStore')
  vi.mocked(fetchGame).mockResolvedValue({ ...baseGame, screenshots: [], videos: [] })

  render(
    <MemoryRouter>
      <GameDetailsPage gameId={baseGame.id} />
    </MemoryRouter>,
  )

  await waitFor(() => {
    expect(screen.getByText('Detail Game')).toBeInTheDocument()
  })

  expect(screen.queryByText('Media')).not.toBeInTheDocument()
})
```

**Step 4: Run tests**

Run: `npm test -w client`
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/components/GameDetailsPage.tsx client/src/components/GameDetailsPage.css client/src/__tests__/GameDetailsPage.test.tsx
git commit -m "feat: reorder PDP layout with media above description, improve key info display"
```

---

### Task 5: Run full test suite

**Step 1: Run all tests**

Run: `npm test`
Expected: All pass

**Step 2: Verify no regressions**

If any tests fail, fix them before committing.
