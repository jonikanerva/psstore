import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    // Half of the cores (default: all but one). The first test of a file
    // pays the cold render of its components, and a 5000 ms timeout counts
    // wall time. Fewer workers per run leave more CPU to each test when
    // several verify runs share the machine (#178). A lone run takes a few
    // seconds longer.
    maxWorkers: '50%',
  },
})
