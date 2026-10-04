import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import pg from 'pg'
import type { PoolClient } from 'pg'

// DATE stays a calendar date. NUMERIC and BIGINT retain pg's exact string representation.
pg.types.setTypeParser(1082, value => value)
export function environment(root: string) {
  const path = resolve(root, '.env')
  return { ...(existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}), ...process.env }
}
export function createPool(root: string, connectionString = environment(root).DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required. See README.md for PostgreSQL setup.')
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, options: '-c timezone=UTC' })
  pool.on('error', error => console.error('PostgreSQL connection error:', error.message))
  return pool
}
export async function transaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
