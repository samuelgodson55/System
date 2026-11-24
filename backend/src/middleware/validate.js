const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

/** router.param handler: a malformed id can never match a row, so answer 404 instead of a DB error (500). */
export function uuidParam(req, res, next, value) {
  if (!isUuid(value)) return res.status(404).json({ error: 'Not found' })
  next()
}

/** Trim a free-text field; empty becomes undefined. */
export const clean = (v) => {
  const t = String(v ?? '').trim()
  return t || undefined
}

/**
 * A whole number from a query string, clamped to [min, max]. Anything that is not a number
 * ("abc", "", NaN) gives `fallback` instead of leaking NaN into SQL (which used to be a 500).
 */
export function intParam(v, { fallback, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(Array.isArray(v) ? v[0] : v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** True for a real calendar day written YYYY-MM-DD (rejects 2026-02-31). */
export function isCalendarDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Escape `%`, `_` and `\` so user text is matched literally inside ILIKE '%…%'. */
export const escapeLike = (v) => String(v ?? '').replace(/[\\%_]/g, '\\$&')

/** Same as `clean` but also collapses inner whitespace runs ("a   b" -> "a b"). */
export const cleanLine = (v) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim()
  return t || undefined
}
