# Product Vision

## Vision

The official PlayStation Store at `store.playstation.com` is a marketing surface. Reaching a relevant view — newly released PS5 games in the Finnish store, priced in euros, with the PS Plus discount visible — takes multiple clicks through regional carousels, mixed-platform listings, and DLC/character/currency products that have nothing to do with games. This product strips the marketing layer away and shows the same Sony data as a fast, calm, utilitarian grid: open the page, see what is new, decide, leave. No accounts, no preferences, no chrome.

## Goal

Let a Finnish PS5 owner see new, upcoming, and discounted games at a glance — with both standard and PS Plus prices visible — without ever navigating the official PlayStation Store.

## Core Principles

- **PS5 + Finland + EUR only, PS Plus pricing visible alongside the standard price.**
  The scope is fixed at the data layer. Non-PS5 SKUs, non-game products (characters, currency, DLC, themes), non-Finnish stores, and other currencies are filtered out before they reach the UI. In short our REST API is a cleaned up official GraphQL API for our use case.

- **Utilitarian surface — only relevant data, no decorative chrome.**
  We just want to present the relevant info to the user. Less clicks the better.

- **No accounts, no user preferences, no tracking.**
  The app works the same way for every visitor on every device. There is nothing to log in to, nothing to configure, nothing personalised. Local storage is for caching Sony's response only, never for remembering user behaviour.

- **Sony's public GraphQL is the source of truth.**
  The backend proxies and normalises Sony's GraphQL, the client renders what the backend returns. Caching exists only to make the page fast; it never becomes state of its own.

- **The default view is the most useful one.**
  Opening the site lands the user on newly released PS5 games, sorted newest-first. Other views are one click away, never the entry point.

## Product Shape

1. The user opens the site. The default view (NEW GAMES) renders: PS5 games released today at the top, then yesterday's, then earlier — descending by release date.
2. A top bar exposes three fixed views — **NEW**, **UPCOMING**, **DISCOUNTED** — and a single free-text search field that filters the currently visible list by game name. The UPCOMING view may include announced titles Sony does not yet price anonymously: these show a price of "Unknown" and link out to Sony's concept page instead of opening an internal product detail page.
3. The user clicks a game card. The product detail page (PDP) opens with the game's full metadata: artwork, description, genres, release date, studio, both prices (standard + PS Plus), and a link out to Sony's store page for the actual purchase.
4. The PDP is identical regardless of which list view the user arrived from.
5. The user closes the tab. The site retains nothing about who they are or what they looked at.

## Non-Goals

The product must not become:

- A storefront that handles purchases itself — purchase always happens on `store.playstation.com` via an outbound link.
- A wishlist / favourites / "owned" tracker — no per-user state of any kind.
- A price-history or deal-alert service — no historical data, no notifications, no emails.
- A community surface — no reviews, ratings, comments, forums, social sharing.
- A multi-region or multi-currency tool — only the Finnish store, only EUR.
- A multi-platform catalogue — only PS5 games. No PS4, no characters, no currency, no DLC, no themes, no apps.
- A personalised product — no themes, no toggles, no remembered sort order, no remembered last view, no per-user defaults.
- An analytics / telemetry product — nothing about user behaviour leaves the device.

## Guardrails for Agents

When making product, UX, or feature decisions:

- Do not expand scope beyond PS5 games in the Finnish store at EUR pricing.

## Decision Filter

A proposed change should only be accepted if it clearly supports the core experience.

Ask:

1. Does it help a Finnish PS5 owner reach relevant PlayStation Store data with fewer clicks or less noise than `store.playstation.com`?
2. Can it be implemented without user accounts, login, or any stored user preferences / per-user state?
3. Does the result stay scoped to PS5 games in the Finnish store at EUR pricing, with both standard and PS Plus prices visible?
4. Does it preserve the utilitarian surface — only essential data, no decorative chrome, no notifications, no social features?

If any answer is "no", the change must not be added.

## Success Definition

The product succeeds when the user feels:

- I see only what is relevant to me — PS5, Finland, EUR — and nothing else.
- I find today's new releases the moment the page loads, without scrolling past carousels.
- I see the PS Plus price and the standard price side-by-side; I never have to wonder which one applies to me.
- I never have to log in, configure anything, or dismiss anything.
- The page is fast, calm, and stays out of my way.

## Persistence and Privacy Posture

- **Persisted on-device:** Sony GraphQL response data only, for client-side rendering performance (browser `localStorage` and/or IndexedDB). Cache entries carry an explicit short-lived TTL and refresh from the backend in the background. **No user preferences, no user identifiers, no behaviour log.**
- **Persisted on-server:** Sony GraphQL response data only, in an in-memory cache (current `server/src/lib/cache.ts`). No database, no on-disk persistence, no per-visitor session state.
- **Never persisted (anywhere):** user identifiers, IP addresses written to durable logs, theme / language / sort / view preferences, click history, search history, viewing history, wishlist data, any per-user state of any kind.

## Audience & Voice

- **Primary audience:** Finnish PS5 owners (starting with the author) who want to browse the Finnish PlayStation Store catalogue without going through Sony's marketing-heavy storefront. Power users — they already know what PS Plus is, what a release date is, and what a price means. The product does not need to teach them anything.
- **Tone:** terse, utilitarian, calm. The data speaks for itself.
- **UI language.** Sony's `fi-fi` locale returns mixed Finnish / English game data. Prefer Finnish but fallback to English when Finnish is not available. The surrounding chrome (tab labels, search placeholder, error states) should in English.
