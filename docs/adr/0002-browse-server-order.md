# ADR 0002: BROWSE uses Sony's order and a verified PS5 product per concept

- Status: accepted
- Date: 2026-10-06

## Context

The owner asked for a BROWSE view: all PS5 games of one Sony genre, in one of these orders: best selling, most downloaded, release date, or name. The owner left the price order out.

The other list views load pages from the server and sort on the client. A non-default sort loads every page first. This works because those lists are short. A BROWSE genre is long: Action has 2230 concepts and Role Playing Games has 726 (observed 2026-10-06). Each card also needs one product lookup for its release date. The client also cannot compute best selling or most downloaded. Only Sony has the sales and download data.

Sony's "All PS5 games" grid (`categoryGridRetrieve`, the same persisted query as NEW) accepts the genre facet `conceptGenres:<KEY>` and the sorts `sales30`, `downloads30`, `conceptReleaseDate`, and `conceptName`. Sony lists these sorts in the grid's `sortingOptions`. The grid also returns the genre facet with 35 genres and a count for each.

The grid lists concepts. The first product of a concept is not always the PS5 game. On the First Person Shooter genre (232 concepts, 2026-10-06), the first product was a PS4 SKU for 19 concepts, a premium edition for 9, and a demo for 2. Two concepts had no product. A card that links to a PS4 SKU opens a missing game page, because the game page accepts only a PS5 full game or bundle.

## Decision

1. BROWSE sorts on the server. The server sends the chosen order to Sony and passes Sony's pages through in Sony's order. The client never sorts a BROWSE list, and the client does not show the sort buttons of the other views. The form has a Browse button: a change of a select fetches nothing.
2. The URL and the API use our own order keys (`best-selling`, `most-downloaded`, `newest`, `oldest`, `name-asc`, `name-desc`). The server maps each key to Sony's sort. Sony's sort names never reach the URL.
3. For each concept the server tries at most 3 product ids. PS5 title ids (`PPSA` in the product id) come first, and otherwise Sony's order stays. The server accepts the first product whose detail shows a PS5 full game or a game bundle. This is the same check as the game page (`isPs5Game`). A concept without such a product is dropped. The `PPSA` prefix only sets the order of the lookups; the product detail decides.
4. The genre menu and the list header show no count. Sony's count includes the concepts that step 3 drops, so it does not match the list (232 against 228 on First Person Shooter).
5. A failed product lookup drops its concept from the response. If no concept on a page resolves and a lookup failed, the page fails with 502. An outage never reads as an empty genre.
6. A raw page that narrows to zero games reads the next raw page, up to 3 pages, as search does. `nextOffset` follows Sony's raw offset.

## Alternatives

- **Load the whole genre and sort on the client, like the other views.** Rejected. One genre needs up to 2230 product lookups, and the client cannot compute best selling or most downloaded.
- **Use the first product of each concept.** Rejected. About 8% of the First Person Shooter cards would open a missing game page.
- **Try every product of a concept.** Rejected. A concept can have 7 products. The probe kept 228 of 232 concepts with at most 3 lookups and needed a third lookup once.
- **Show Sony's counts.** Rejected by the owner's rule: show a count only when it matches the list.
- **Offer Sony's price sort (`webBasePrice`).** Left out by the owner. Sony does not list it in `sortingOptions`, and it sorts by the base price, not by the discounted or the PS Plus price.

## Consequences

- The app has two sort models: client sorts on the other views and Sony sorts on BROWSE. The BROWSE form makes the difference visible.
- Sony's order can change between two page requests, so a game can repeat or move across pages. The client removes repeated ids.
- Sony sorts the release date orders by the concept release date. A card shows the release date of the chosen product. The two dates can differ, so a card date can look out of order (observed on Horror, newest first, 2026-10-06). ADR 0001 describes the same difference for NEW and UPCOMING.
- The name filter of the search field covers the loaded BROWSE pages only. While a filter is active, the list loads no further page. Otherwise a filter that leaves few cards would load the whole genre.
- A card shows the concept's list price. The game page shows the price of the chosen product. The two can differ when the concept's first product is not the chosen product.
- The first load of a page costs about one product lookup per concept, at most 10 at a time. The product lookups are in the server cache, and the game page reuses them.
- An unknown genre key is checked by format only. Sony answers it with an empty grid (observed 2026-10-06). The client sends only keys from the genre list.

## Cost of reversal

Low. BROWSE is one route, one service method, and one view. The other views do not depend on it.

## Reassessment

Reassess when Sony removes a sort from `sortingOptions`, when `pnpm test:live` shows that the BROWSE page or the genre facet changed shape, or when the scope check drops many more concepts than the 2026-10-06 probe.
