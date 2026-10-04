import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from './connection'

export async function migrate(pool: Pool) {
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(87314001)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied: string[] = []
    const directory = new URL('./migrations/', import.meta.url)
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(new URL(name, directory), 'utf8')
      const hash = createHash('sha256').update(sql).digest('hex')
      const existing = await client.query('SELECT sha256 FROM schema_migrations WHERE name=$1', [name])
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== hash) throw new Error(`Applied migration ${name} changed; create a new migration instead.`)
        continue
      }
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(name,sha256) VALUES ($1,$2)', [name,hash])
      applied.push(name)
    }
    return applied
  })
}
