import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ps-gql': {
        target: 'https://web.np.playstation.com/api/graphql/v1/op',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/ps-gql/, ''),
        headers: {
          Host: 'web.np.playstation.com',
        },
      },
    },
  },
})
