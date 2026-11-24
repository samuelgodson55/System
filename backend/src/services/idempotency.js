/**
 * Replay protection for bulk requests.
 *
 * A double-click, a flaky connection or an impatient retry must never book the same batch twice.
 * The browser sends a random `requestId` with each batch. While a batch is running, a second
 * request with the same id is refused; once it has finished, a repeat with the SAME content gets
 * the original result back instead of being booked again. A repeat whose content has changed is
 * treated as a new batch. Failed requests are forgotten, so they can simply be retried.
 *
 * Kept in memory (the API is a single process): after a restart a retry is treated as new, which is
 * the same behaviour as before this existed. Entries expire after 15 minutes.
 */
const TTL_MS = 15 * 60 * 1000
const MAX_ENTRIES = 2000
const entries = new Map() // key -> { state: 'running' | 'done', fingerprint, result, at }

function sweep() {
  const now = Date.now()
  for (const [k, v] of entries) if (now - v.at > TTL_MS) entries.delete(k)
  // hard cap: drop the oldest first
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value)
}

const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v)

/**
 * Run `fn` at most once per (user, requestId, content). Returns { result, replayed }.
 * Throws { status: 409 } when the same request is still running.
 */
export async function runOnce(userKey, requestId, fingerprint, fn) {
  if (!validId(requestId)) return { result: await fn(), replayed: false }
  sweep()
  const key = `${userKey}:${requestId}`
  const hit = entries.get(key)
  if (hit && hit.fingerprint === fingerprint) {
    if (hit.state === 'done') return { result: hit.result, replayed: true }
    const err = new Error('This batch is already being saved – please wait a moment')
    err.status = 409
    throw err
  }
  const entry = { state: 'running', fingerprint, result: null, at: Date.now() }
  entries.set(key, entry)
  try {
    const result = await fn()
    entry.state = 'done'
    entry.result = result
    entry.at = Date.now()
    return { result, replayed: false }
  } catch (e) {
    if (entries.get(key) === entry) entries.delete(key)
    throw e
  }
}
