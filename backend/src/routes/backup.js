import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { markRecipientsStale } from '../services/recipients.js'
import { pool } from '../db/pool.js'
import { applySchema } from '../db/schema.js'

const execFileAsync = promisify(execFile)
const router = Router()
router.use(authenticate, requireAdmin)

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups')

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  }
}

function parseDbUrl(url) {
  const u = new URL(url)
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.replace(/^\//, ''),
  }
}

// Only one backup/restore may run at a time: two restores overlapping would interleave their
// DROP/CREATE statements, and a backup taken mid-restore would capture a half-restored database.
let busy = null
async function exclusive(label, fn) {
  if (busy) {
    const err = new Error(`A ${busy} is already running – wait for it to finish`)
    err.status = 409
    throw err
  }
  busy = label
  try {
    return await fn()
  } finally {
    busy = null
  }
}

const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** pg_dump into BACKUP_DIR. Never overwrites an existing file; removes a half-written one on failure. */
async function dumpTo(prefix) {
  ensureBackupDir()
  const db = parseDbUrl(process.env.DATABASE_URL)
  let filename = `${prefix}_${stampNow()}.sql`
  for (let n = 2; fs.existsSync(path.join(BACKUP_DIR, filename)); n++) {
    filename = `${prefix}_${stampNow()}-${n}.sql`
  }
  const filepath = path.join(BACKUP_DIR, filename)
  const env = { ...process.env, PGPASSWORD: db.password }
  try {
    await execFileAsync(
      'pg_dump',
      [
        '-h', db.host,
        '-p', String(db.port),
        '-U', db.user,
        '-d', db.database,
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
        '-f', filepath,
      ],
      { env, timeout: 120000 }
    )
  } catch (e) {
    // a truncated .sql would look like a valid backup in the list and fail (or half-apply) when restored
    fs.rmSync(filepath, { force: true })
    throw e
  }
  const stat = fs.statSync(filepath)
  return { filename, size: stat.size, createdAt: stat.mtime.toISOString() }
}

/** pg_dump / psql errors can be long and mention the connection; show the person the useful tail only. */
const shortError = (e, fallback) => String(e?.stderr?.toString?.() || e?.message || fallback).trim().slice(-800)

function safeFilename(name) {
  const base = path.basename(name)
  if (!/^[\w.\-]+$/.test(base) || !base.endsWith('.sql')) {
    return null
  }
  return base
}

// Create backup
router.post('/', async (req, res) => {
  try {
    const out = await exclusive('backup or restore', () => dumpTo('inventory_backup'))
    res.status(201).json({ ...out, message: 'Backup created successfully' })
  } catch (e) {
    console.error('Backup failed:', e)
    res.status(e.status || 500).json({ error: e.status ? e.message : shortError(e, 'Backup failed') })
  }
})

// List backups
router.get('/', async (_req, res) => {
  try {
    ensureBackupDir()
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f))
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        }
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    res.json(files)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to list backups' })
  }
})

// Download
router.get('/:filename', async (req, res) => {
  try {
    ensureBackupDir()
    const filename = safeFilename(req.params.filename)
    if (!filename) return res.status(400).json({ error: 'Invalid filename' })
    const filepath = path.join(BACKUP_DIR, filename)
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' })
    res.download(filepath, filename)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to download backup' })
  }
})

// Restore from an existing backup file
router.post('/:filename/restore', async (req, res) => {
  try {
    ensureBackupDir()
    const filename = safeFilename(req.params.filename)
    if (!filename) return res.status(400).json({ error: 'Invalid filename' })
    const filepath = path.join(BACKUP_DIR, filename)
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' })

    const db = parseDbUrl(process.env.DATABASE_URL)
    const env = { ...process.env, PGPASSWORD: db.password }

    const safety = await exclusive('backup or restore', async () => {
      // A restore REPLACES everything now in the database. Snapshot the current state first, so a
      // wrong file chosen by mistake can be undone from the list. If the snapshot cannot be made,
      // nothing is restored.
      const snapshot = await dumpTo('inventory_before_restore')

      // Drop & recreate public schema objects via restore.
      // Using --clean with psql on a dump that was created with --no-owner.
      // For safety we run in a single psql session.
      await execFileAsync(
        'psql',
        [
          '-h', db.host,
          '-p', String(db.port),
          '-U', db.user,
          '-d', db.database,
          '-v', 'ON_ERROR_STOP=1',
          '--single-transaction',
          '-f', filepath,
        ],
        { env, timeout: 180000 }
      )
      // A backup from before a newer feature existed brings the OLD table shapes back. Bring the schema
      // up to date again right away (additive and idempotent) instead of waiting for the next restart.
      try {
        await applySchema(pool)
      } catch (schemaError) {
        console.error('Schema refresh after restore failed (restart the API to retry):', schemaError)
      }
      return snapshot
    })

    // the restored ledger may hold recipients the pick-list has not seen yet
    markRecipientsStale()

    res.json({
      message: `Database restored from ${filename}. The state before the restore was saved as ${safety.filename}.`,
      filename,
      safetyBackup: safety.filename,
      restoredAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Restore failed:', e)
    res.status(e.status || 500).json({ error: e.status ? e.message : shortError(e, 'Restore failed') })
  }
})

// Delete
router.delete('/:filename', async (req, res) => {
  try {
    ensureBackupDir()
    const filename = safeFilename(req.params.filename)
    if (!filename) return res.status(400).json({ error: 'Invalid filename' })
    const filepath = path.join(BACKUP_DIR, filename)
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' })
    fs.unlinkSync(filepath)
    res.status(204).end()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to delete backup' })
  }
})

export default router
