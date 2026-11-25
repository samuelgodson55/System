import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import compression from 'compression'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { pool } from './db/pool.js'
import authRoutes from './routes/auth.js'
import itemsRoutes from './routes/items.js'
import unitsRoutes from './routes/units.js'
import eventsRoutes from './routes/events.js'
import transactionsRoutes from './routes/transactions.js'
import backupRoutes from './routes/backup.js'
import settingsRoutes from './routes/settings.js'
import exportRoutes from './routes/exports.js'
import faultRoutes from './routes/faults.js'
import categoryRoutes from './routes/categories.js'
import recipientRoutes from './routes/recipients.js'
import userRoutes from './routes/users.js'
import siteRoutes from './routes/sites.js'

dotenv.config()

// ---- configuration checks ---------------------------------------------------------------------
// Fail fast on a missing secret (every login would otherwise end in a 500 at runtime), and say out
// loud when the well-known development secret is still in use. It is only a warning: existing
// installs keep running, and changing the secret signs everybody out once.
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set')
  process.exit(1)
}
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set')
  process.exit(1)
}
const WEAK_SECRETS = ['inventory-dev-secret-key-change-in-prod', 'change-me-in-production-use-long-random-string']
if (WEAK_SECRETS.includes(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32) {
  console.warn(
    'WARNING: JWT_SECRET is a default/short value. Anyone who knows it can forge a login. ' +
      'Set JWT_SECRET to a long random string (e.g. `openssl rand -hex 32`) in the .env next to docker-compose.yml.'
  )
}

const app = express()
const PORT = process.env.PORT || 4000

app.disable('x-powered-by')
// The API sits behind exactly one reverse proxy (the nginx container with Docker Compose, Render's
// load balancer on Render): trust one hop so req.ip is the real client (needed by the login rate limiter;
// without it every user would share the proxy's address). Override with TRUST_PROXY if the layout differs.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1))

// Baseline security headers for every API response (no dependency needed for these).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

// Content-Disposition carries the download's file name; expose it for cross-origin (dev) use
// CORS_ORIGINS (comma-separated) restricts cross-origin browser access. Unset keeps the old behaviour (open),
// which is harmless for the same-origin deployments (the browser never makes a cross-origin call there).
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean)
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, exposedHeaders: ['Content-Disposition'] }))
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/items', itemsRoutes)
app.use('/api/units', unitsRoutes)
app.use('/api/events', eventsRoutes)
app.use('/api/transactions', transactionsRoutes)
app.use('/api/backups', backupRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/exports', exportRoutes)
app.use('/api/faults', faultRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/recipients', recipientRoutes)
app.use('/api/users', userRoutes)
app.use('/api/sites', siteRoutes)

// An unknown API path is a JSON 404 (it used to be Express's HTML error page)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

app.use((err, _req, res, _next) => {
  // Bad client input is the client's problem (4xx), not a server fault
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' })
  if (res.headersSent) return res.destroy(err)
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

// ---- optional: serve the built React app (single-container hosting such as Render) --------------
// With SERVE_FRONTEND=true this process also serves the static frontend, so the whole app fits one web
// service (Docker Compose uses a separate nginx container instead and leaves this off).
if (['1', 'true'].includes(String(process.env.SERVE_FRONTEND || '').toLowerCase())) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR || path.join(here, '..', 'public'))
  const indexFile = path.join(FRONTEND_DIR, 'index.html')
  if (!fs.existsSync(indexFile)) {
    console.error(`FATAL: SERVE_FRONTEND is on but ${indexFile} does not exist (was the frontend built?)`)
    process.exit(1)
  }
  // Compression is applied to static files only (API responses, incl. streamed exports, are untouched).
  app.use(compression())
  app.use(
    express.static(FRONTEND_DIR, {
      index: false,
      // Vite emits content-hashed files under /assets: safe to cache for a year.
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    })
  )
  // Single-page-app fallback: any other GET that is not the API gets the page shell. It must never be
  // cached, or an old index.html would point at hashed files that no longer exist after a release.
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexFile)
  })
  console.log(`Serving frontend from ${FRONTEND_DIR}`)
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Inventory API listening on :${PORT}`)
})

// ---- shutdown & last-resort handlers ----------------------------------------------------------
// `docker stop` sends SIGTERM: stop taking new requests, let running ones (a stock booking
// mid-transaction, a backup) finish, then close the database pool. A hard stop after 15s.
let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received – shutting down`)
  const force = setTimeout(() => {
    console.error('Shutdown timed out – forcing exit')
    process.exit(1)
  }, 15000)
  force.unref()
  server.close(async () => {
    try {
      await pool.end()
    } catch (e) {
      console.error(e)
    }
    process.exit(0)
  })
  server.closeIdleConnections?.()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// A forgotten `await` somewhere must not take the whole API down silently or leave it half-alive:
// log it clearly. (An uncaught exception is unsafe to continue from, so that one still exits and
// Docker's restart policy brings the API straight back.)
process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason))
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  process.exit(1)
})
