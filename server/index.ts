import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { api } from './api'
import { Store } from './store'

const root = resolve(import.meta.dirname, '..')
const store = new Store(root)
const handler = api(store)
createServer((req, res) => {
  if (req.url?.startsWith('/api/')) { void handler(req, res); return }
  try {
    const pathname = new URL(req.url!, 'http://localhost').pathname
    const relative = pathname === '/' ? 'dist/index.html' : `dist/${decodeURIComponent(pathname.slice(1))}`
    const file = store.path(relative)
    const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' })
    res.end(readFileSync(file))
  } catch { res.writeHead(404); res.end('Not found') }
}).listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => console.log('Career Assistant: http://127.0.0.1:' + (process.env.PORT ?? 3000)))
