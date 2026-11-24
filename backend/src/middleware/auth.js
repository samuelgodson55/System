import jwt from 'jsonwebtoken'
import { query } from '../db/pool.js'

// Pin the algorithm: the token must be HS256 (what signToken produces). Without this the library
// accepts whatever the secret type allows, which is wider than this app ever issues.
export const JWT_ALGORITHM = 'HS256'

// While an account is flagged "must change password" (admin-issued temporary password) it may only
// use these endpoints, so the temporary password can't be used to work in the app.
const ALLOWED_WHILE_PASSWORD_CHANGE_PENDING = new Set(['/api/auth/me', '/api/auth/profile'])

/**
 * Verifies the signed token AND re-reads the account, so that:
 *  - the role is always the live one (a demoted admin loses admin rights immediately, not when the
 *    7-day token expires);
 *  - a deleted account, or one signed out by a password reset / recovery (token_version bump), stops working at once.
 * Tokens issued before token_version existed carry no `tv`; that counts as 0, which is every existing
 * account's version, so nobody is signed out by the upgrade.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  let payload
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  try {
    const { rows } = await query(
      'SELECT id, username, name, role, token_version, must_change_password FROM users WHERE id = $1',
      [payload.id]
    )
    const u = rows[0]
    if (!u || (payload.tv ?? 0) !== u.token_version) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.user = { id: u.id, username: u.username, name: u.name, role: u.role }
    if (u.must_change_password && !ALLOWED_WHILE_PASSWORD_CHANGE_PENDING.has(req.originalUrl.split('?')[0])) {
      return res.status(403).json({
        error: 'You must change your temporary password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      })
    }
    next()
  } catch (e) {
    // a database hiccup is not a bad login: do not sign anybody out for it
    console.error('authenticate failed', e)
    return res.status(503).json({ error: 'Service temporarily unavailable' })
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
