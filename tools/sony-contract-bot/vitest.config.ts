import { defineConfig } from 'vitest/config'

// Only run TypeScript tests under src — the package compiles to `dist`, whose
// `dist/**/*.test.js` would otherwise be picked up and run a second time.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
