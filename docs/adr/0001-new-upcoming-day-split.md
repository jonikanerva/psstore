# ADR 0001: Split NEW and UPCOMING at the viewer's next local day

- Status: accepted
- Date: 2026-10-05

## Context

Sony gives two PS5 grids: `conceptReleaseDate:last_thirty_days` (released) and `conceptReleaseDate:next_thirty_days` (upcoming). Sony files a game in a grid by the concept release date. The card shows the product release date. The two dates can differ. On 2026-10-05 the upcoming grid held five products that were already out (for example MXGP 26, released 2026-09-28). None of them was in the released grid.

NEW read only the released grid. UPCOMING read only the upcoming grid and applied no date filter. A released game that Sony filed as upcoming therefore showed in UPCOMING and never in NEW. An earlier `> now` filter on UPCOMING dropped such a game from both views (`docs/contracts/reports/graphql-store-parity-spike.md`, section D.2).

The owner set the product rule: NEW shows every game released today, also later today. UPCOMING starts tomorrow. The day is the viewer's local day, not the UTC day. Both views keep their pages and the infinite scroll.

## Decision

1. The server reads both grids for NEW and for UPCOMING. It merges them, removes repeated product ids, and classifies each game by its product release date. A failure of either grid fails both lists. One grid alone can silently omit a released game.
2. The server never receives the viewer's time zone. It sends each list a superset of the local-day split:
   - NEW: dated games released before `now + 37 h`, newest first.
   - UPCOMING: games released at or after `now - 12 h`, soonest first, and undated games last.

   In every time zone the next local midnight is at most 25 hours after `now` (24 hours, plus 1 hour on the day that daylight saving time ends). The 12-hour margin absorbs a client clock that is up to 12 hours off. A game near the boundary is in both lists.

3. The client computes the start of its next local day with luxon (`startOf('day').plus({ days: 1 })`). NEW keeps the dated games before that instant. UPCOMING keeps the rest. Each game shows in one view only.
4. The released grid keeps dated product SKUs only, as before. A released-grid product without a date (for example after a failed detail lookup) shows in no view. Undated products and concept-only announcements come from the upcoming grid and show in UPCOMING only.

## Alternatives

- **The client sends its day boundary as a query parameter, and the server filters exactly.** Rejected. The server contract would carry a value derived from the viewer's time zone, and the server would validate a new client input. STACK.md §12 keeps the server in UTC.
- **The server returns one merged list, and the client splits it.** Rejected. The client cannot split a sorted list correctly from its first page, so the server must send the whole list at once. This removes the pages and the infinite scroll from NEW and UPCOMING.
- **The server splits at the UTC day or the Helsinki day.** Rejected. The owner chose the viewer's local day.

## Consequences

- NEW shows a released game that Sony files as upcoming, and UPCOMING no longer shows it.
- NEW also shows a game that releases later today.
- NEW and UPCOMING each read two grids. The grids and the product details are in the server cache, so the second view costs almost no Sony calls.
- A game that releases later today shows in NEW with its pre-order state. An earlier invariant kept pre-orders out of NEW (`graphql-store-parity-spike.md`, section B). The owner chose this change.
- `totalCount` of each server list includes the games near the boundary, so it can be higher than the count that the client shows. The client does not read `totalCount`.
- A page can lose some of its games to the split. A page that the split empties does not show the empty text while more pages exist.
- If a page stays open over midnight, a game released on the new day can be missing from NEW until the next fetch. TanStack Query refetches when the window gets focus and the data is older than 5 minutes.
- A client clock that is more than 12 hours off can lose games near the boundary from both views.

## Cost of reversal

Low. The change is in `server/src/domain/listing.ts`, `server/src/services/gamesService.ts`, `client/src/modules/releaseDay.ts`, and `client/src/components/Games.tsx`. The API shape does not change.

## Reassessment

Reassess when Sony offers a product release date filter for the grids, or when NEW or UPCOMING lose their pages.
