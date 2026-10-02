import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'dashboard',
  plugins: [react()],
  // The Markdown source of truth lives outside the Vite root.
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true },
})
