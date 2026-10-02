import { api } from './server/api'
import { Store } from './server/store'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'dashboard',
  plugins: [react(), {
    name: 'markdown-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        req.url = '/api' + req.url
        void api(new Store(resolve(import.meta.dirname)))(req, res)
      })
    },
  }],
  // The Markdown source of truth lives outside the Vite root.
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true },
})
