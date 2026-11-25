/**
 * Site (store / location) scoping.
 *
 * Every stock route runs `requireSite` after `authenticate`. It decides which site the request works in and
 * puts it on `req.siteId` / `req.site`; every query then filters by that id.
 *
 *  - STAFF always work in the site assigned to their account. Nothing they send can change that: the
 *    `X-Site-Id` header is ignored for them, so there is no way to read or write another site's stock.
 *  - ADMINS choose the site they are working in with the `X-Site-Id` header (the app's site switcher).
 *    Without the header they get the default (oldest active) site, which keeps older browser tabs working.
 *  - A deactivated site is read-only for everyone.
 *
 * Anything that belongs to another site answers 404 ("not found"), never 403, so ids of other sites'
 * records are not even confirmed to exist.
 */
import { query } from '../db/pool.js'
import { isUuid } from './validate.js'

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function requireSite(req, res, next) {
  try {
    let siteId
    if (req.user?.role === 'admin') {
      const header = req.headers['x-site-id']
      if (header) {
        if (!isUuid(header)) return res.status(400).json({ error: 'Invalid site', code: 'SITE_INVALID' })
        siteId = header
      } else {
        const { rows } = await query(
          'SELECT id FROM sites ORDER BY is_active DESC, created_at, id LIMIT 1'
        )
        siteId = rows[0]?.id
      }
    } else {
      siteId = req.user?.siteId
      if (!siteId) {
        return res.status(403).json({
          error: 'Your account is not assigned to a site yet. Ask an administrator to assign you one.',
          code: 'NO_SITE_ASSIGNED',
        })
      }
    }
    const { rows } = siteId
      ? await query('SELECT id, name, is_active FROM sites WHERE id = $1', [siteId])
      : { rows: [] }
    const site = rows[0]
    if (!site) return res.status(404).json({ error: 'Site not found', code: 'SITE_NOT_FOUND' })
    if (!site.is_active && !READ_ONLY_METHODS.has(req.method)) {
      return res.status(403).json({
        error: `${site.name} is deactivated and read-only. Reactivate it under Sites to make changes.`,
        code: 'SITE_INACTIVE',
      })
    }
    req.siteId = site.id
    req.site = { id: site.id, name: site.name, isActive: site.is_active }
    next()
  } catch (e) {
    console.error('requireSite failed', e)
    res.status(503).json({ error: 'Service temporarily unavailable' })
  }
}

/** router.param handler for an ITEM id: the item must belong to the request's site (else 404). */
export async function siteItemParam(req, res, next, value) {
  try {
    const { rows } = await query('SELECT 1 FROM items WHERE id = $1 AND site_id = $2', [value, req.siteId])
    if (!rows.length) return res.status(404).json({ error: 'Item not found' })
    next()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load item' })
  }
}

/** router.param handler for an EVENT id: the event must belong to the request's site (else 404). */
export async function siteEventParam(req, res, next, value) {
  try {
    const { rows } = await query('SELECT 1 FROM events WHERE id = $1 AND site_id = $2', [value, req.siteId])
    if (!rows.length) return res.status(404).json({ error: 'Event not found' })
    next()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load event' })
  }
}

/** Inside a transaction: every id must be an item of this site. Throws the given error factory's error otherwise. */
export async function assertItemsInSite(db, siteId, itemIds, makeError) {
  const ids = [...new Set(itemIds)]
  if (!ids.length) return
  const { rows } = await db.query('SELECT id FROM items WHERE id = ANY($1::uuid[]) AND site_id = $2', [ids, siteId])
  if (rows.length !== ids.length) throw makeError('Item not found')
}

/** Inside a transaction: an event id (when given) must belong to this site. */
export async function assertEventInSite(db, siteId, eventId, makeError) {
  if (!eventId) return
  const { rows } = await db.query('SELECT 1 FROM events WHERE id = $1 AND site_id = $2', [eventId, siteId])
  if (!rows.length) throw makeError('That event does not belong to this site')
}
