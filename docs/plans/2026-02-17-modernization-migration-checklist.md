# Migration Checklist

- [x] Create `codex/` feature branch
- [x] Preserve route parity: `/new`, `/upcoming`, `/discounted`, `/plus`, `/search`, `/g/:gameId`
- [x] Move frontend to `client/`
- [x] Add Express backend in `server/` with `/api/games/*`
- [x] Add `shared/` package for schemas/types/utils
- [x] Switch package manager workflow to npm workspaces
- [x] Add unit tests for mapping, validation, and search/filter behavior
- [x] Add production static serving + SPA fallback in server
- [x] Update README for Railway deployment
