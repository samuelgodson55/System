/**
 * Sites (stores / locations).
 *
 *  GET    /api/sites            admin: every site with counts · staff: only their own site
 *  GET    /api/sites/overview   admin: headline numbers per site (dashboard "all sites" view)
 *  POST   /api/sites            admin: create a site (optionally copy another site's catalogue, at zero stock)
 *  PUT    /api/sites/:id        admin: rename / edit address / (de)activate
 *  DELETE /api/sites/:id        admin: only a site with no items, events or staff
 *
 * Sites are never deleted while they hold data: deactivating one keeps its history and makes it read-only.
 */
import { Router } from 'express'
import { query, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { uuidParam, isUuid, cleanLine } from '../middleware/validate.js'
import { HttpError } from '../services/kits.js'
import { auditLog } from '../services/accounts.js'

// Serialises everything that changes WHICH sites exist or are active (deactivate / delete). Without it two admins
// deactivating two different sites at the same moment would each see the other still active and both succeed,
// leaving no active site. Released automatically when the transaction ends.
const SITE_STATE_LOCK = 'SELECT pg_advisory_xact_lock(727275)'

const router = Router()
router.use(authenticate)
router.param('id', uuidParam)

const mapSite = (r) => ({
  id: r.id,
  name: r.name,
  address: r.address || '',
  isActive: r.is_active,
  createdAt: r.created_at,
  ...(r.item_count !== undefined
    ? { itemCount: Number(r.item_count), staffCount: Number(r.staff_count), eventCount: Number(r.event_count) }
    : {}),
})

const WITH_COUNTS = `
  SELECT s.*,
    (SELECT COUNT(*) FROM items i WHERE i.site_id = s.id) AS item_count,
    (SELECT COUNT(*) FROM users u WHERE u.site_id = s.id AND u.role = 'staff') AS staff_count,
    (SELECT COUNT(*) FROM events e WHERE e.site_id = s.id) AS event_count
  FROM sites s`

function fail(res, e, fallback) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
  if (e?.code === '23505') return res.status(409).json({ error: 'A site with that name already exists' })
  console.error(e)
  return res.status(500).json({ error: fallback })
}

function readFields(body, { requireName }) {
  const out = {}
  if (body?.name !== undefined || requireName) {
    const name = cleanLine(body?.name)
    if (!name) throw new HttpError(400, 'Site name is required')
    if (name.length > 120) throw new HttpError(400, 'Site name must be 120 characters or fewer')
    out.name = name
  }
  if (body?.address !== undefined) {
    const address = cleanLine(body.address) || null
    if (address && address.length > 200) throw new HttpError(400, 'Address must be 200 characters or fewer')
    out.address = address
  }
  return out
}

router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      const { rows } = req.user.siteId
        ? await query('SELECT * FROM sites WHERE id = $1', [req.user.siteId])
        : { rows: [] }
      return res.json(rows.map(mapSite))
    }
    const { rows } = await query(`${WITH_COUNTS} ORDER BY s.is_active DESC, lower(s.name)`)
    res.json(rows.map(mapSite))
  } catch (e) {
    fail(res, e, 'Failed to load sites')
  }
})

router.get('/overview', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.is_active,
         (SELECT COUNT(*) FROM items i WHERE i.site_id = s.id) AS item_count,
         (SELECT COUNT(*) FROM items i WHERE i.site_id = s.id AND i.quantity <= i.reorder_level) AS low_stock_count,
         (SELECT COUNT(*) FROM item_faults f JOIN items i ON i.id = f.item_id
            WHERE i.site_id = s.id AND f.status = 'open') AS open_faults,
         (SELECT COUNT(*) FROM events e WHERE e.site_id = s.id AND e.status = 'active') AS active_events,
         (SELECT COUNT(*) FROM users u WHERE u.site_id = s.id AND u.role = 'staff') AS staff_count,
         (SELECT COUNT(*) FROM transactions t JOIN items i ON i.id = t.item_id
            WHERE i.site_id = s.id AND t.created_at >= NOW() - INTERVAL '30 days') AS movements_30d
       FROM sites s ORDER BY s.is_active DESC, lower(s.name)`
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.is_active,
        itemCount: Number(r.item_count),
        lowStockCount: Number(r.low_stock_count),
        openFaults: Number(r.open_faults),
        activeEvents: Number(r.active_events),
        staffCount: Number(r.staff_count),
        movements30d: Number(r.movements_30d),
      }))
    )
  } catch (e) {
    fail(res, e, 'Failed to load the overview')
  }
})

router.post('/', requireAdmin, async (req, res) => {
  try {
    const f = readFields(req.body, { requireName: true })
    const copyFrom = req.body?.copyCatalogueFrom || null
    if (copyFrom && !isUuid(copyFrom)) throw new HttpError(400, 'Invalid site to copy from')
    const created = await withTransaction(async (client) => {
      if (copyFrom) {
        const { rows: src } = await client.query('SELECT 1 FROM sites WHERE id = $1', [copyFrom])
        if (!src.length) throw new HttpError(400, 'The site to copy from does not exist')
      }
      const { rows } = await client.query('INSERT INTO sites (name, address) VALUES ($1, $2) RETURNING *', [
        f.name,
        f.address ?? null,
      ])
      const site = rows[0]
      if (copyFrom) await copyCatalogue(client, copyFrom, site.id)
      return site
    })
    auditLog(req.user.username, copyFrom ? 'created a site (catalogue copied) named' : 'created a site named', created.name)
    const { rows } = await query(`${WITH_COUNTS} WHERE s.id = $1`, [created.id])
    res.status(201).json(mapSite(rows[0]))
  } catch (e) {
    fail(res, e, 'Failed to create site')
  }
})

/** Items (at ZERO stock), their enabled units and their kit pieces, copied from one site to another. */
async function copyCatalogue(client, fromId, toId) {
  await client.query(
    `INSERT INTO items (sku, name, description, category, quantity, base_unit_id, reorder_level, location,
                        item_type, pieces_per_set, kit_notes, site_id)
     SELECT sku, name, description, category, 0, base_unit_id, reorder_level, NULL,
            item_type, pieces_per_set, kit_notes, $2
     FROM items WHERE site_id = $1`,
    [fromId, toId]
  )
  await client.query(
    `INSERT INTO item_units (item_id, unit_id, conversion_factor, units_per_base)
     SELECT n.id, iu.unit_id, iu.conversion_factor, iu.units_per_base
     FROM item_units iu
     JOIN items o ON o.id = iu.item_id AND o.site_id = $1
     JOIN items n ON n.site_id = $2 AND n.sku = o.sku
     ON CONFLICT DO NOTHING`,
    [fromId, toId]
  )
  await client.query(
    `INSERT INTO kit_components (kit_id, name, quantity_per_kit, loose_quantity, notes, position, is_active)
     SELECT n.id, kc.name, kc.quantity_per_kit, 0, kc.notes, kc.position, TRUE
     FROM kit_components kc
     JOIN items o ON o.id = kc.kit_id AND o.site_id = $1
     JOIN items n ON n.site_id = $2 AND n.sku = o.sku
     WHERE kc.is_active`,
    [fromId, toId]
  )
}

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const f = readFields(req.body, { requireName: false })
    const wantsActive = req.body?.isActive !== undefined
    if (wantsActive && typeof req.body.isActive !== 'boolean') throw new HttpError(400, 'isActive must be true or false')
    if (!Object.keys(f).length && !wantsActive) throw new HttpError(400, 'Nothing to change')
    await withTransaction(async (client) => {
      await client.query(SITE_STATE_LOCK)
      const { rows } = await client.query('SELECT * FROM sites WHERE id = $1 FOR UPDATE', [req.params.id])
      const cur = rows[0]
      if (!cur) throw new HttpError(404, 'Site not found')
      if (wantsActive && !req.body.isActive && cur.is_active) {
        const { rows: others } = await client.query(
          'SELECT 1 FROM sites WHERE is_active AND id <> $1 LIMIT 1', [cur.id]
        )
        if (!others.length) throw new HttpError(409, 'At least one site must stay active.')
      }
      await client.query(
        `UPDATE sites SET name = $1, address = $2, is_active = $3, updated_at = NOW() WHERE id = $4`,
        [
          f.name ?? cur.name,
          f.address !== undefined ? f.address : cur.address,
          wantsActive ? req.body.isActive : cur.is_active,
          cur.id,
        ]
      )
    })
    const { rows } = await query(`${WITH_COUNTS} WHERE s.id = $1`, [req.params.id])
    res.json(mapSite(rows[0]))
  } catch (e) {
    fail(res, e, 'Failed to update site')
  }
})

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await withTransaction(async (client) => {
      await client.query(SITE_STATE_LOCK)
      const { rows } = await client.query(`${WITH_COUNTS} WHERE s.id = $1 FOR UPDATE OF s`, [req.params.id])
      const cur = rows[0]
      if (!cur) throw new HttpError(404, 'Site not found')
      const { rows: count } = await client.query('SELECT COUNT(*) AS n FROM sites')
      if (Number(count[0].n) <= 1) throw new HttpError(409, 'The only site cannot be deleted.')
      if (Number(cur.item_count) || Number(cur.event_count) || Number(cur.staff_count)) {
        throw new HttpError(
          409,
          'This site still has items, events or staff. Deactivate it instead to keep its history, or move the staff first.'
        )
      }
      await client.query('DELETE FROM sites WHERE id = $1', [cur.id])
      auditLog(req.user.username, 'deleted the empty site', cur.name)
    })
    res.status(204).end()
  } catch (e) {
    if (e?.code === '23503') return res.status(409).json({ error: 'This site is still in use and cannot be deleted.' })
    fail(res, e, 'Failed to delete site')
  }
})

export default router
