import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export class StoreError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const revision = (content: string) => createHash('sha256').update(content).digest('hex')
// status, timeline and cv have their own operations so their side effects are never skipped.
export const EDITABLE_FIELDS = ['company', 'role', 'priority', 'type', 'location', 'applied_at', 'job_url', 'rate', 'contact', 'next_action', 'tags'] as const
export type ApplicationFields = Partial<Record<(typeof EDITABLE_FIELDS)[number], unknown>>

/** Configuration and static files under the project root; domain data lives in PostgreSQL. */
export class Store {
  constructor(public root: string) { this.root = resolve(root) }
  path(relative: string) {
    const parts = relative.split('/')
    if (parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) throw new StoreError(400, 'Invalid path')
    let path = this.root
    for (const part of parts) {
      path = join(path, part)
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new StoreError(400, 'Symbolic links are not supported')
    }
    return path
  }
  read(relative: string) {
    const path = this.path(relative)
    if (!existsSync(path)) throw new StoreError(404, 'File not found')
    return readFileSync(path, 'utf8')
  }
  write(relative: string, content: string, expected: string | null) {
    const path = this.path(relative)
    const current = existsSync(path) ? revision(this.read(relative)) : null
    if (current !== expected) throw new StoreError(409, 'File changed. Reload before saving.')
    const temporary = join(dirname(path), `.write-${randomUUID()}`)
    try {
      writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
      // Recheck immediately before replacement, including edits made outside the app.
      if ((existsSync(path) ? revision(this.read(relative)) : null) !== expected) throw new StoreError(409, 'File changed. Reload before saving.')
      renameSync(temporary, path)
    } finally { if (existsSync(temporary)) unlinkSync(temporary) }
    return revision(content)
  }
}
