import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin, JWT_ALGORITHM } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import {
  USERNAME_RE, MIN_PASSWORD, MAX_PASSWORD_BYTES, BCRYPT_COST, passwordProblem,
  generateRecoveryCodes, countUnusedCodes, findRecoveryCode, auditLog,
} from '../services/accounts.js'

const router = Router()

// Columns every sign-in / session read needs
const USER_COLS =
  'id, username, password_hash, name, role, token_version, must_change_password, recovery_codes, site_id,' +
  ' (SELECT s.name FROM sites s WHERE s.id = users.site_id) AS site_name'

// The passwords the seed script creates. Accounts still using one are flagged so the app can nag.
const SEED_PASSWORDS = { admin: 'admin123', staff: 'staff123' }
const defaultPasswordCache = new Map() // password_hash -> boolean (bcrypt is slow; a hash never changes)
async function usesSeedPassword(user) {
  const seed = SEED_PASSWORDS[user.username]
  if (!seed) return false
  if (!defaultPasswordCache.has(user.password_hash)) {
    if (defaultPasswordCache.size > 100) defaultPasswordCache.clear()
    defaultPasswordCache.set(user.password_hash, await bcrypt.compare(seed, user.password_hash))
  }
  return defaultPasswordCache.get(user.password_hash)
}

// Brute-force protection: 10 tries per person+address in 15 minutes (a correct login clears that
// person's counter, so normal use is never affected), plus a generous per-address ceiling that only
// stops one machine from spraying many usernames. `req.ip` is the real client address because the
// API trusts the nginx proxy in front of it (see `trust proxy` in index.js).
const WINDOW = 15 * 60 * 1000
const loginKey = (req) => `${req.ip}|${String(req.body?.username ?? '').trim().toLowerCase().slice(0, 50)}`
const loginLimiter = rateLimit({ windowMs: WINDOW, max: 10, key: loginKey })
const loginIpLimiter = rateLimit({ windowMs: WINDOW, max: 200, key: (req) => req.ip })

// Compared against when the username does not exist, so a wrong username takes as long as a wrong
// password and cannot be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role })

// What the browser keeps: the public fields plus the flags that drive the UI. Admins also learn how many
// recovery codes they have left, so the app can nudge them to create a set.
const sessionUser = (u, extra = {}) => ({
  ...publicUser(u),
  mustChangePassword: !!u.must_change_password,
  // staff: the one site they work in; admins have none of their own (they switch between sites)
  siteId: u.site_id || null,
  siteName: u.site_name || null,
  ...(u.role === 'admin' ? { recoveryCodesRemaining: countUnusedCodes(u.recovery_codes) } : {}),
  ...extra,
})

// `tv` ties the token to the account's token_version: bumping that column signs the account out everywhere.
const signToken = (u) =>
  jwt.sign({ ...publicUser(u), tv: u.token_version ?? 0 }, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })

router.post('/login', loginIpLimiter, loginLimiter, async (req, res) => {
  try {
    // Only strings are accepted: an object/array here used to reach the database driver and end as a 500
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' })
    }
    // no real account has a name/password this long; skip the slow hash work for junk input
    if (username.length > 50 || Buffer.byteLength(password) > 1024) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }
    const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE username = $1`, [username])
    const user = rows[0]
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH)
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }
    loginLimiter.reset(loginKey(req))
    res.json({
      token: signToken(user),
      user: sessionUser(user, { defaultPassword: password === SEED_PASSWORDS[user.username] }),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Reads the live row, so a changed name/username shows up and a deleted account is signed out.
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.user.id])
    if (rows.length === 0) return res.status(401).json({ error: 'Account no longer exists' })
    res.json({ user: sessionUser(rows[0], { defaultPassword: await usesSeedPassword(rows[0]) }) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

/**
 * Edit own profile. Body (all optional): { name, username, currentPassword, newPassword }.
 * Changing the username or password requires the current password. Returns a fresh token
 * because the old one carries the old username/name.
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, username, currentPassword, newPassword } = req.body || {}
    const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.user.id])
    if (rows.length === 0) return res.status(401).json({ error: 'Account no longer exists' })
    const user = rows[0]

    const nextName = name === undefined ? user.name : String(name).replace(/\s+/g, ' ').trim()
    const nextUsername = username === undefined ? user.username : String(username).trim()
    const wantsPassword = newPassword !== undefined && newPassword !== ''
    const usernameChanged = nextUsername !== user.username

    if (!nextName) return res.status(400).json({ error: 'Name is required' })
    if (nextName.length > 120) return res.status(400).json({ error: 'Name must be 120 characters or fewer' })

    if (usernameChanged) {
      if (!USERNAME_RE.test(nextUsername)) {
        return res.status(400).json({
          error: 'Username must be 3–50 characters: letters, numbers, dot, dash or underscore',
        })
      }
      const { rows: taken } = await query(
        'SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2',
        [nextUsername, user.id]
      )
      if (taken.length > 0) return res.status(409).json({ error: 'That username is already taken' })
    }

    if (wantsPassword && String(newPassword).length < MIN_PASSWORD) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` })
    }
    if (wantsPassword && Buffer.byteLength(String(newPassword)) > MAX_PASSWORD_BYTES) {
      return res.status(400).json({ error: `New password is too long (at most ${MAX_PASSWORD_BYTES} bytes)` })
    }

    if (usernameChanged || wantsPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Enter your current password to change your username or password' })
      }
      const ok = await bcrypt.compare(String(currentPassword), user.password_hash)
      if (!ok) return res.status(403).json({ error: 'Current password is incorrect' })
    }

    if (wantsPassword && String(newPassword) === String(currentPassword)) {
      return res.status(400).json({ error: 'The new password must be different from the current one' })
    }

    const hash = wantsPassword ? await bcrypt.hash(String(newPassword), BCRYPT_COST) : user.password_hash
    // A new password signs every OTHER session out (token_version) and ends a "must change" flag;
    // the fresh token returned below keeps this one going.
    const { rows: saved } = await query(
      `UPDATE users SET name = $1, username = $2, password_hash = $3,
         token_version = token_version + $5::int,
         must_change_password = CASE WHEN $5::int = 1 THEN FALSE ELSE must_change_password END
       WHERE id = $4 RETURNING ${USER_COLS}`,
      [nextName, nextUsername, hash, user.id, wantsPassword ? 1 : 0]
    )
    if (wantsPassword) auditLog(user.username, 'changed their own password')
    res.json({
      token: signToken(saved[0]),
      user: sessionUser(saved[0], { defaultPassword: false }),
      message: 'Profile updated',
    })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That username is already taken' })
    console.error(e)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// ---------------------------------------------------------------------------------------------------
// Admin account recovery codes
//
// An admin who forgets their password has nobody above them to reset it, so each admin can keep a set
// of one-time recovery codes somewhere safe. Codes are random (60 bits each), stored only as bcrypt
// hashes, shown ONCE when generated, and each works a single time. Generating a new set replaces the
// old one. Staff do not get codes: an admin resets a staff password instead.
// ---------------------------------------------------------------------------------------------------

// Re-entering the password guards the generate action against someone using an unattended session.
const codeGenLimiter = rateLimit({ windowMs: WINDOW, max: 10, key: (req) => `gen|${req.user.id}` })

router.get('/recovery-codes', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT recovery_codes, recovery_codes_generated_at FROM users WHERE id = $1', [req.user.id])
    res.json({
      remaining: countUnusedCodes(rows[0]?.recovery_codes),
      total: Array.isArray(rows[0]?.recovery_codes) ? rows[0].recovery_codes.length : 0,
      generatedAt: rows[0]?.recovery_codes_generated_at || null,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load recovery codes' })
  }
})

/** POST { currentPassword } → a NEW set of codes (the previous set stops working). */
router.post('/recovery-codes', authenticate, requireAdmin, codeGenLimiter, async (req, res) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
    if (!currentPassword) return res.status(400).json({ error: 'Enter your password to create recovery codes' })
    const { rows } = await query('SELECT password_hash, username FROM users WHERE id = $1', [req.user.id])
    if (!rows.length) return res.status(401).json({ error: 'Account no longer exists' })
    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(403).json({ error: 'Your password is incorrect' })
    }
    codeGenLimiter.reset(`gen|${req.user.id}`)
    const { plain, stored } = await generateRecoveryCodes()
    const { rows: saved } = await query(
      `UPDATE users SET recovery_codes = $1::jsonb, recovery_codes_generated_at = NOW()
       WHERE id = $2 RETURNING recovery_codes_generated_at`,
      [JSON.stringify(stored), req.user.id]
    )
    auditLog(rows[0].username, 'generated a new set of recovery codes')
    res.status(201).json({ codes: plain, generatedAt: saved[0].recovery_codes_generated_at })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to create recovery codes' })
  }
})

// Brute-force protection for the (unauthenticated) recovery endpoint: strict per person+address, plus a
// per-address ceiling. A code has 60 bits, so these limits make guessing hopeless.
const recoverKey = (req) => `${req.ip}|${String(req.body?.username ?? '').trim().toLowerCase().slice(0, 50)}`
const recoverLimiter = rateLimit({ windowMs: WINDOW, max: 5, key: recoverKey })
const recoverIpLimiter = rateLimit({ windowMs: WINDOW, max: 30, key: (req) => req.ip })

/**
 * POST { username, recoveryCode, newPassword } – sets a new password for an ADMIN account using one
 * unused recovery code. The code is burned, every existing session of the account is signed out, and
 * the person signs in with the new password. Every failure gets the same message, so the answer does
 * not reveal whether the username exists, is an admin, or has codes.
 */
router.post('/recover', recoverIpLimiter, recoverLimiter, async (req, res) => {
  const FAIL = { error: 'The username or recovery code is not valid' }
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const recoveryCode = typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode : ''
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
    if (!username || !recoveryCode || !newPassword) {
      return res.status(400).json({ error: 'Username, recovery code and new password are required' })
    }
    const problem = passwordProblem(newPassword, 'New password')
    if (problem) return res.status(400).json({ error: problem })
    if (username.length > 50 || recoveryCode.length > 64) return res.status(400).json(FAIL)

    const outcome = await withTransaction(async (client) => {
      // lock the row: two requests can never spend the same code
      const { rows } = await client.query(
        'SELECT id, username, role, recovery_codes FROM users WHERE username = $1 FOR UPDATE',
        [username]
      )
      const u = rows[0]
      if (!u || u.role !== 'admin') {
        await bcrypt.compare(recoveryCode, DUMMY_HASH) // same cost as a real check
        return null
      }
      const idx = await findRecoveryCode(u.recovery_codes, recoveryCode)
      if (idx < 0) return null
      const codes = u.recovery_codes.map((c, i) => (i === idx ? { ...c, used: new Date().toISOString() } : c))
      await client.query(
        `UPDATE users SET password_hash = $1, recovery_codes = $2::jsonb,
           must_change_password = FALSE, token_version = token_version + 1
         WHERE id = $3`,
        [await bcrypt.hash(newPassword, BCRYPT_COST), JSON.stringify(codes), u.id]
      )
      return { username: u.username, remaining: countUnusedCodes(codes) }
    })
    if (!outcome) return res.status(400).json(FAIL)
    recoverLimiter.reset(recoverKey(req))
    auditLog(outcome.username, `reset their password with a recovery code (${outcome.remaining} left)`)
    res.json({
      message: 'Password updated. Sign in with your new password.',
      remaining: outcome.remaining,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Recovery failed' })
  }
})

export default router
