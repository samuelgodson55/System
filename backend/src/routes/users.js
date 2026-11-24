/**
 * User management (admin only): list accounts, create them, change a role, reset a password, remove one.
 *
 * Safeguards:
 *  - every change needs the acting admin's own password again (a left-open session can't be used to
 *    mint admins or lock people out);
 *  - an admin can't change their own role or remove themselves, and the last admin can never be
 *    demoted or removed, so the system can't end up without an administrator;
 *  - temporary passwords are random, shown once, and must be changed at first sign-in;
 *  - a reset, role change or removal signs the affected account out everywhere (token_version);
 *  - every change is written to the API log ("[security] …"), never including a password.
 */
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { uuidParam } from '../middleware/validate.js'
import { HttpError } from '../services/kits.js'
import {
  USERNAME_RE, ROLES, BCRYPT_COST, passwordProblem, generateTempPassword, auditLog,
} from '../services/accounts.js'

const router = Router()
router.use(authenticate, requireAdmin)
router.param('id', uuidParam)

const mapUser = (r) => ({
  id: r.id,
  username: r.username,
  name: r.name,
  role: r.role,
  mustChangePassword: r.must_change_password,
  createdAt: r.created_at,
})

function fail(res, e, fallback) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
  if (e?.code === '23505') return res.status(409).json({ error: 'That username is already taken' })
  console.error(e)
  return res.status(500).json({ error: fallback })
}

// Wrong confirmation passwords are limited (a correct one clears the counter, so normal use is never slowed).
const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `confirm|${req.user.id}`,
})

/** Checks the acting admin's password (body.adminPassword). Throws HttpError when missing or wrong. */
async function confirmActingAdmin(req) {
  const pw = typeof req.body?.adminPassword === 'string' ? req.body.adminPassword : ''
  if (!pw) throw new HttpError(400, 'Enter your own password to confirm this change')
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!rows.length || !(await bcrypt.compare(pw, rows[0].password_hash))) {
    throw new HttpError(403, 'Your password is incorrect')
  }
  confirmLimiter.reset(`confirm|${req.user.id}`)
}

const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** Locks and counts admins inside a transaction (stops two simultaneous demotions both succeeding). */
async function adminCountLocked(client) {
  const { rows } = await client.query("SELECT id FROM users WHERE role = 'admin' FOR UPDATE")
  return rows.length
}

// GET /api/users
router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, username, name, role, must_change_password, created_at FROM users ORDER BY lower(name), username'
    )
    res.json(rows.map(mapUser))
  } catch (e) {
    fail(res, e, 'Failed to load users')
  }
})

/**
 * POST /api/users { username, name, role?, password?, adminPassword }
 * No password given → a random temporary one is generated. Either way the person must change it at first sign-in.
 * Responds with `temporaryPassword` ONCE.
 */
router.post('/', confirmLimiter, async (req, res) => {
  try {
    await confirmActingAdmin(req)
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const name = cleanName(req.body?.name)
    const role = req.body?.role ?? 'staff'
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–50 characters: letters, numbers, dot, dash or underscore' })
    }
    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (name.length > 120) return res.status(400).json({ error: 'Name must be 120 characters or fewer' })
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role must be admin or staff' })
    const supplied = typeof req.body?.password === 'string' && req.body.password !== ''
    if (supplied) {
      const problem = passwordProblem(req.body.password)
      if (problem) return res.status(400).json({ error: problem })
    }
    const temporaryPassword = supplied ? req.body.password : generateTempPassword()
    const hash = await bcrypt.hash(temporaryPassword, BCRYPT_COST)
    const { rows: taken } = await query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])
    if (taken.length) return res.status(409).json({ error: 'That username is already taken' })
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, name, role, must_change_password)
       VALUES ($1,$2,$3,$4,TRUE)
       RETURNING id, username, name, role, must_change_password, created_at`,
      [username, hash, name, role]
    )
    auditLog(req.user.username, `created ${role} account`, username)
    res.status(201).json({ user: mapUser(rows[0]), temporaryPassword })
  } catch (e) {
    fail(res, e, 'Failed to create user')
  }
})

/** PUT /api/users/:id { role?, name?, adminPassword } – change a role and/or display name. */
router.put('/:id', confirmLimiter, async (req, res) => {
  try {
    await confirmActingAdmin(req)
    const wantsRole = req.body?.role !== undefined
    const wantsName = req.body?.name !== undefined
    if (!wantsRole && !wantsName) return res.status(400).json({ error: 'Nothing to change' })
    if (wantsRole && !ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Role must be admin or staff' })
    const name = wantsName ? cleanName(req.body.name) : null
    if (wantsName && (!name || name.length > 120)) {
      return res.status(400).json({ error: 'Name is required (120 characters at most)' })
    }
    const saved = await withTransaction(async (client) => {
      const admins = await adminCountLocked(client)
      const { rows } = await client.query('SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id])
      const cur = rows[0]
      if (!cur) throw new HttpError(404, 'User not found')
      const roleChanges = wantsRole && req.body.role !== cur.role
      if (roleChanges) {
        if (cur.id === req.user.id) {
          throw new HttpError(409, "You can't change your own role. Ask another admin to do it.")
        }
        if (cur.role === 'admin' && admins <= 1) {
          throw new HttpError(409, 'This is the only admin, so it cannot be changed to staff.')
        }
      }
      const { rows: out } = await client.query(
        `UPDATE users SET role = $1, name = COALESCE($2, name),
           token_version = token_version + $3::int
         WHERE id = $4
         RETURNING id, username, name, role, must_change_password, created_at`,
        [roleChanges ? req.body.role : cur.role, name, roleChanges ? 1 : 0, cur.id]
      )
      if (roleChanges) auditLog(req.user.username, `changed role ${cur.role} → ${req.body.role} for`, cur.username)
      else auditLog(req.user.username, 'renamed account', cur.username)
      return out[0]
    })
    res.json({ user: mapUser(saved) })
  } catch (e) {
    fail(res, e, 'Failed to update user')
  }
})

/**
 * POST /api/users/:id/reset-password { adminPassword, newPassword? }
 * Sets a temporary password (random when none is given). The person is signed out everywhere and must
 * choose their own password at next sign-in. Resetting your OWN password is done from My profile.
 */
router.post('/:id/reset-password', confirmLimiter, async (req, res) => {
  try {
    await confirmActingAdmin(req)
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Use My profile to change your own password' })
    }
    const supplied = typeof req.body?.newPassword === 'string' && req.body.newPassword !== ''
    if (supplied) {
      const problem = passwordProblem(req.body.newPassword, 'Temporary password')
      if (problem) return res.status(400).json({ error: problem })
    }
    const temporaryPassword = supplied ? req.body.newPassword : generateTempPassword()
    const hash = await bcrypt.hash(temporaryPassword, BCRYPT_COST)
    const { rows } = await query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, token_version = token_version + 1
       WHERE id = $2 RETURNING username`,
      [hash, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    auditLog(req.user.username, 'reset the password of', rows[0].username)
    res.json({ temporaryPassword, username: rows[0].username })
  } catch (e) {
    fail(res, e, 'Failed to reset password')
  }
})

/** DELETE /api/users/:id { adminPassword } – remove an account. Past stock records keep the person's name as text. */
router.delete('/:id', confirmLimiter, async (req, res) => {
  try {
    await confirmActingAdmin(req)
    await withTransaction(async (client) => {
      const admins = await adminCountLocked(client)
      const { rows } = await client.query('SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id])
      const cur = rows[0]
      if (!cur) throw new HttpError(404, 'User not found')
      if (cur.id === req.user.id) throw new HttpError(409, "You can't remove your own account.")
      if (cur.role === 'admin' && admins <= 1) throw new HttpError(409, 'This is the only admin and cannot be removed.')
      await client.query('DELETE FROM users WHERE id = $1', [cur.id])
      auditLog(req.user.username, 'removed account', cur.username)
    })
    res.status(204).end()
  } catch (e) {
    fail(res, e, 'Failed to remove user')
  }
})

export default router
