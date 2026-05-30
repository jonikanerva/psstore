import { defineConfig } from 'vitest/config'

// Only run TypeScript tests under src. Without this, the default glob also
// matches the compiled `dist/**/*.test.js` (built by `tsc` for the package),
// running every test twice and tripping over stale compiled output.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
