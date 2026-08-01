import { defineConfig } from 'vite'

// The server serves `dist/` itself, so a production build is single-origin and
// one ngrok tunnel covers everything. `npm run dev` proxies to the API instead.
export default defineConfig({
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})
