import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool, types } = pg

// A DATE column (events.start_date / end_date) is a calendar day, not a moment in time. By default
// node-pg turns it into a JS Date at local midnight, which the API then sent as
// "2026-11-20T00:00:00.000Z": the browser's date input cannot show that, and on a server whose time
// zone is not UTC the day silently shifts by one. Keep it as the plain "YYYY-MM-DD" text instead.
types.setTypeParser(1082, (value) => value)

// TLS to the database is opt-in (DATABASE_SSL=true). Docker Compose and Render's *internal* database URL
// are private networks and need none; Render's *external* URL (reached from your own computer) requires it.
// `rejectUnauthorized: false` accepts Render's certificate without shipping its CA; the traffic is still encrypted.
const useSsl = ['1', 'true'].includes(String(process.env.DATABASE_SSL || '').toLowerCase())

// Connection pool for concurrent request handling
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  // Render's free Postgres allows ~100 connections in total; 20 is plenty for one small instance
  max: Number(process.env.DB_POOL_MAX) || 20, // concurrent connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err)
})

// Per-query logging is opt-in (LOG_QUERIES=1). It used to run whenever NODE_ENV was not "production",
// which the containers never set, so every request wrote several log lines and the log grew forever.
const LOG_QUERIES = ['1', 'true'].includes(String(process.env.LOG_QUERIES || '').toLowerCase())

export async function query(text, params) {
  const start = Date.now()
  const res = await pool.query(text, params)
  if (LOG_QUERIES) {
    console.log('query', { text: text.slice(0, 80), duration: Date.now() - start, rows: res.rowCount })
  }
  return res
}

export async function withTransaction(fn) {
  const client = await pool.connect()
  let broken = null
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      // The connection itself is broken: keep the ORIGINAL error, but make sure this connection is
      // destroyed (release(err)) instead of going back into the pool where it would poison later requests.
      console.error('ROLLBACK failed', rollbackError)
      broken = rollbackError
    }
    throw e
  } finally {
    client.release(broken || undefined)
  }
}
