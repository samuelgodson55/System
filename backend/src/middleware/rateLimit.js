/**
 * Tiny in-memory rate limiter (no dependency). The API is a single process, so memory is enough.
 *
 *   const limiter = rateLimit({ windowMs: 15 * 60_000, max: 10, key: (req) => ... })
 *   router.post('/login', limiter, handler)
 *   limiter.reset(key)    // e.g. after a successful login
 *
 * Responds 429 with a Retry-After header once a key has used up its allowance in the window.
 */
export function rateLimit({ windowMs, max, key, message = 'Too many attempts – please wait a few minutes and try again' }) {
  const hits = new Map() // key -> { count, resetAt }

  const sweep = (now) => {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  }
  // keep the map from growing without bound even if nobody calls the limiter for a while
  const timer = setInterval(() => sweep(Date.now()), Math.min(windowMs, 60_000))
  timer.unref?.()

  function middleware(req, res, next) {
    const now = Date.now()
    const k = String(key(req))
    let e = hits.get(k)
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs }
      hits.set(k, e)
    }
    e.count += 1
    if (hits.size > 10_000) sweep(now)
    if (e.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((e.resetAt - now) / 1000)))
      return res.status(429).json({ error: message })
    }
    next()
  }
  middleware.reset = (k) => hits.delete(String(k))
  return middleware
}
