# Repository Guidelines

## Project Structure & Module Organization

- `src/` — React + TypeScript source. UI lives under `src/components/`; data access in `src/modules/psnStore.ts` (GraphQL).
- `index.html` — Vite entry (root). Static assets under `public/` (e.g., `/favicon.png`).
- `build/` — Production output from Vite (`outDir=build`).
- `nginx.conf` and `nginx.dev.conf` — Nginx configs for prod and dev proxying.
- `Dockerfile` — Nginx-based image serving the built SPA and proxying `/ps-gql`.

## Build, Test, and Development Commands

- `yarn dev` — Start Vite dev server with `/ps-gql` proxied to PlayStation GraphQL.
- `yarn build` — Lints, cleans, and produces a production bundle in `build/`.
- `yarn preview` — Preview the production bundle locally.
- `yarn docker:build` — Build app and Docker image `docker.pkg.github.com/jonikanerva/dok8s/psstore:latest`.
- `yarn docker:run` — Run the image at `http://localhost:8080`.
- `yarn docker:push` — Push the image to GitHub Packages.

## Coding Style & Naming Conventions

- TypeScript, strict mode; React 19 with the modern JSX runtime.
- CSS: keep BEM-style class names, kebab-case (e.g., `games--filter-name`).
- Use Prettier and ESLint/Stylelint:
  - `yarn format` — Auto-format TS/CSS/JSON.
  - `yarn lint` — Run ESLint, TypeScript, Stylelint, and Prettier checks.

## Testing Guidelines

- No test suite is configured. If adding logic-heavy code, prefer lightweight unit tests (e.g., Vitest) colocated under `src/**/__tests__` and named `*.test.ts`.
- Keep tests fast and deterministic; mock network calls.

## Commit & Pull Request Guidelines

- Commits: concise, imperative subject lines; scope where helpful (e.g., `feat(psn): migrate to gql grid`).
- PRs: include a clear summary, linked issues, before/after screenshots for UI, and steps to verify (`yarn dev`, `yarn build`, Docker run instructions).

## Security & Configuration Tips

- All network calls go through `/ps-gql`; do not call upstream GraphQL directly from the browser.
- Never commit secrets or tokens. Nginx proxies handle CORS and headers.
- Validate external data defensively when mapping to internal types.

## Agent-Specific Instructions

- Maintain Vite compatibility (no custom build shims). Do not change `outDir=build`.
- Keep REST → GraphQL mapping isolated in `src/modules/psnStore.ts` and avoid UI churn.
- When touching styles, preserve existing class names and variable usage.
- Always verify any Codex-suggested changes by running `yarn build`.
