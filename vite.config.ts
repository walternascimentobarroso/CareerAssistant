import { api } from './server/api.ts'
import { PostgresStore } from './server/postgres-store.ts'
import { createPool } from './server/db/connection.ts'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'dashboard',
  plugins: [react(), {
    name: 'postgresql-api',
    configureServer(server) {
      const pool = createPool(resolve(import.meta.dirname))
      const handler = api(new PostgresStore(resolve(import.meta.dirname),pool))
      server.httpServer?.once('close', () => { void pool.end() })
      server.middlewares.use('/api', (req, res) => {
        req.url = '/api' + req.url
        void handler(req,res)
      })
    },
  }],
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true },
})
