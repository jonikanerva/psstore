# Product Vision

## Vision

An easy-to-use PS5 store. Open the page and see the PS5 games that matter to you — new, upcoming, discounted, monthly PS Plus, or already purchased — without the marketing layer of `store.playstation.com`. Purchases still happen in Sony's store.

## Goal

Let a Finnish PS5 owner find new, upcoming, discounted, monthly PS Plus, and purchased PS5 games in as few clicks as possible, with the standard and PS Plus prices side by side.

## Core Principles

- **PS5 games, Finnish store, EUR.** Nothing else reaches the user: no other platforms, no add-ons, no other regions or currencies.
- **Fast and calm.** Only the data the user needs. No marketing, no decorative chrome.
- **Sony is the source of truth.** We show Sony's data in a cleaner form. We do not create data of our own.
- **The default view is the most useful one.** The site opens on new PS5 releases, newest first.

## Product Shape

1. The site opens on NEW: PS5 games, newest release first.
2. Five views: NEW, UPCOMING, DISCOUNTED, MONTHLY, PURCHASED. One search field filters the current view by name.
3. A game card opens the game page: artwork, description, details, both prices, and a link to buy in Sony's store.

## Non-Goals

- A storefront — purchases happen in Sony's store.
- A wishlist, price-history, or deal-alert service.
- A community or social surface.
- A multi-region, multi-currency, or multi-platform catalogue.
- A configurable product — no settings, themes, or remembered preferences.
- A PS Plus membership manager or claim tracking.
- A tracking or analytics product.

## Decision Filter

1. Does it help a Finnish PS5 owner find relevant PS5 games with fewer clicks or less noise than Sony's own store?
2. Does it work without settings, user preferences, or tracking?
3. Does it stay within PS5 games, the Finnish store, and EUR?
4. Does it keep the surface calm — only essential data, no decorative chrome, no notifications, no social features?

If any answer is "no", the change must not be added.

## Success Definition

- I see only what is relevant to me: PS5, Finland, EUR.
- I see today's new releases the moment the page loads.
- I see the PS Plus price and the standard price side by side.
- I see this month's PS Plus games in one view.
- I find a game I already own by typing part of its name.
- The page is fast and calm.

## Persistence and Privacy Posture

- **Stored:** Sony store data, cached briefly to make the site fast.
- **User data:** data from the user's PSN sign-in is used only to show that user their own data. We keep no user profile.
- **Never:** tracking, analytics, behaviour history, or user preferences.

## Audience & Voice

- **Audience:** Finnish PS5 owners who already know what PS Plus is and what a price means. The product teaches nothing.
- **Tone:** terse and calm. The data speaks for itself.
- **Language:** Site content and UI in English.
