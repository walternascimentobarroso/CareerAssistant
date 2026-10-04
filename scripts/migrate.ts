import { resolve } from 'node:path'
import { createPool } from '../server/db/connection'
import { migrate } from '../server/db/migrate'

const pool = createPool(resolve(import.meta.dirname, '..'))
try { console.log('Applied migrations:', await migrate(pool)) }
finally { await pool.end() }
