import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import readline from 'readline'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
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

// ---- uploading a backup made earlier (the server's disk may be ephemeral, e.g. on Render) ------------
const UPLOAD_MAX_BYTES = Math.max(1, Number(process.env.BACKUP_UPLOAD_MAX_MB) || 200) * 1024 * 1024

/**
 * An uploaded .sql file is fed to `psql`, which would also run its backslash meta-commands
 * (`\\! <shell command>`, `\\copy ... program`) on THIS server. A genuine pg_dump file contains none of them
 * outside COPY data blocks, so the file is scanned line by line BEFORE it is accepted and anything else
 * is refused. It must also look like a dump of this application (users + items tables).
 * Returns null when acceptable, otherwise a message for the person.
 */
async function inspectDump(filepath) {
  const rl = readline.createInterface({ input: fs.createReadStream(filepath, { encoding: 'utf8' }), crlfDelay: Infinity })
  let lineNo = 0
  let inCopy = false
  let sawHeader = false
  let sawUsers = false
  let sawItems = false
  const bad = (why) => `Not a valid backup from this system: ${why} (line ${lineNo}).`
  try {
    for await (const line of rl) {
      lineNo += 1
      if (inCopy) {
        if (line === '\\.') inCopy = false
        continue // COPY rows legitimately contain backslash escapes (\\N, \\t ...)
      }
      if (lineNo <= 30 && line.includes('PostgreSQL database dump')) sawHeader = true
      if (lineNo > 30 && !sawHeader) return 'This file is not a pg_dump SQL backup.'
      if (/^\\(un)?restrict\s+\S+\s*$/.test(line)) continue // emitted by newer pg_dump versions
      if (/^COPY\s/i.test(line)) {
        if (!/^COPY\s.+\sFROM\s+stdin;\s*$/i.test(line)) return bad('a COPY statement reads from somewhere other than the file')
        inCopy = true
        continue
      }
      const unquoted = line.replace(/'(?:[^']|'')*'/g, "''") // a backslash inside a string literal is plain data
      if (unquoted.includes('\\')) return bad('it contains a psql command, which is not allowed')
      if (/\bPROGRAM\b/i.test(unquoted)) return bad('it runs an external program')
      if (/^\s*(DROP\s+(DATABASE|ROLE|USER)|CREATE\s+(DATABASE|ROLE|USER)|ALTER\s+(ROLE|USER|SYSTEM)|SET\s+ROLE|SET\s+SESSION\s+AUTHORIZATION)\b/i.test(unquoted)) {
        return bad('it changes database-wide settings or roles')
      }
      const ext = /^\s*CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i.exec(unquoted)
      if (ext && ext[1].toLowerCase() !== 'pgcrypto') return bad(`it installs the extension "${ext[1]}"`)
      if (/^CREATE TABLE (public\.)?users\b/i.test(line)) sawUsers = true
      if (/^CREATE TABLE (public\.)?items\b/i.test(line)) sawItems = true
    }
  } finally {
    rl.close()
  }
  if (inCopy) return 'The file ends in the middle of a table (it looks cut off or incomplete).'
  if (!sawHeader) return 'This file is not a pg_dump SQL backup.'
  if (!sawUsers || !sawItems) return 'This file does not look like a backup of this inventory system (users / items tables not found).'
  return null
}

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

// Upload a backup file (raw request body, name in the X-Filename header). The file is checked and then
// stored next to the other backups; restoring it is a separate, confirmed step. Streamed to disk, so a
// large dump never sits in memory.
router.post('/upload', async (req, res) => {
  ensureBackupDir()
  const tmp = path.join(BACKUP_DIR, `.upload-${crypto.randomBytes(6).toString('hex')}.tmp`)
  try {
    const declared = Number(req.headers['content-length'])
    if (declared > UPLOAD_MAX_BYTES) {
      return res.status(413).json({ error: `File is too large (limit ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB)` })
    }
    let rawName = ''
    try {
      rawName = decodeURIComponent(String(req.headers['x-filename'] || ''))
    } catch {
      rawName = ''
    }
    if (!/\.sql$/i.test(rawName)) return res.status(400).json({ error: 'Choose a .sql backup file' })

    let received = 0
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length
        if (received > UPLOAD_MAX_BYTES) {
          const err = new Error(`File is too large (limit ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB)`)
          err.status = 413
          return cb(err)
        }
        cb(null, chunk)
      },
    })
    await pipeline(req, limiter, fs.createWriteStream(tmp, { flags: 'wx' }))
    if (received === 0) return res.status(400).json({ error: 'The file is empty' })

    const problem = await inspectDump(tmp)
    if (problem) return res.status(400).json({ error: problem })

    const base = path
      .basename(rawName, path.extname(rawName))
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^[._]+/, '')
      .slice(0, 80) || 'backup'
    let filename = `uploaded_${stampNow()}_${base}.sql`
    for (let n = 2; fs.existsSync(path.join(BACKUP_DIR, filename)); n++) filename = `uploaded_${stampNow()}_${base}-${n}.sql`
    fs.renameSync(tmp, path.join(BACKUP_DIR, filename))
    const stat = fs.statSync(path.join(BACKUP_DIR, filename))
    res.status(201).json({
      filename,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
      message: 'Backup uploaded. Review it and choose Restore to apply it.',
    })
  } catch (e) {
    console.error('Backup upload failed:', e)
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Upload failed – please try again' })
  } finally {
    fs.rmSync(tmp, { force: true })
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
          kind: f.startsWith('uploaded_') ? 'uploaded' : f.startsWith('inventory_before_restore_') ? 'safety' : 'manual',
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
