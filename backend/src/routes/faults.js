/**
 * Faulty-item register.
 *
 *   GET    /api/faults            list (status, usability, itemId, search, page, limit) + summary counts
 *   GET    /api/faults/summary    open-fault counts per item (badges, issue-time warnings)
 *   POST   /api/faults            report a fault
 *   PUT    /api/faults/:id        edit a fault
 *   POST   /api/faults/:id/resolve  close a fault (repaired / replaced / written off / no fault)
 *   POST   /api/faults/:id/reopen   open it again
 *   DELETE /api/faults/:id        admin only
 *
 * A fault never changes stock or the ledger. "usable" faults are informational (the item may
 * still be issued, with the workaround shown); "unusable" ones mark pieces as out of service.
 */
import { Router } from 'express'
import { query } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { uuidParam, isUuid, clean } from '../middleware/validate.js'

const router = Router()
router.use(authenticate)
router.param('id', uuidParam)

const USABILITY = ['usable', 'unusable']
const RESOLUTIONS = ['repaired', 'replaced', 'written_off', 'no_fault']

const SELECT = `
  SELECT f.*, i.name AS item_name, i.sku, i.item_type, kc.name AS component_name,
         CASE WHEN i.item_type = 'kit' THEN (CASE WHEN f.component_id IS NULL THEN 'sets' ELSE 'pcs' END)
              ELSE bu.abbreviation END AS unit
  FROM item_faults f
  JOIN items i ON i.id = f.item_id
  LEFT JOIN kit_components kc ON kc.id = f.component_id
  LEFT JOIN units bu ON bu.id = i.base_unit_id`

const map = (r) => ({
  id: r.id,
  itemId: r.item_id,
  itemName: r.item_name,
  sku: r.sku,
  itemType: r.item_type,
  componentId: r.component_id || null,
  componentName: r.component_name || null,
  description: r.description,
  usability: r.usability,
  workaround: r.workaround || '',
  quantityAffected: Number(r.quantity_affected),
  unit: r.unit || '',
  foundWith: r.found_with || '',
  status: r.status,
  reportedBy: r.reported_by || '',
  reportedAt: r.reported_at,
  resolution: r.resolution || null,
  resolutionNotes: r.resolution_notes || '',
  resolvedBy: r.resolved_by || '',
  resolvedAt: r.resolved_at || null,
})

const bad = (res, msg) => res.status(400).json({ error: msg })

/** Validate the editable fields; returns { error } or { value }. */
async function readBody(b, itemId) {
  const description = clean(b.description)
  if (!description) return { error: 'Describe the fault' }
  if (description.length > 1000) return { error: 'Fault description must be 1000 characters or fewer' }
  const usability = b.usability ?? 'usable'
  if (!USABILITY.includes(usability)) return { error: 'Usability must be "usable" or "unusable"' }
  const workaround = clean(b.workaround)
  if (workaround && workaround.length > 1000) return { error: 'Workaround must be 1000 characters or fewer' }
  const foundWith = clean(b.foundWith)
  if (foundWith && foundWith.length > 200) return { error: '"Found with" must be 200 characters or fewer' }
  const qty = Number(b.quantityAffected ?? 1)
  // stored as NUMERIC(14,4): anything under 0.0001 would round to 0 and break the "> 0" rule (a 500)
  if (!Number.isFinite(qty) || qty < 0.0001 || qty > 99999999) return { error: 'Quantity affected must be more than 0' }
  let componentId = null
  if (b.componentId) {
    if (!isUuid(b.componentId)) return { error: 'Invalid kit piece' }
    const r = await query('SELECT 1 FROM kit_components WHERE id = $1 AND kit_id = $2', [b.componentId, itemId])
    if (!r.rows.length) return { error: 'That piece does not belong to this kit' }
    componentId = b.componentId
  }
  return { value: { description, usability, workaround: workaround || null, foundWith: foundWith || null, qty, componentId } }
}

async function fetchOne(id) {
  const { rows } = await query(`${SELECT} WHERE f.id = $1`, [id])
  return rows[0] ? map(rows[0]) : null
}

router.get('/summary', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT item_id, COUNT(*) AS open,
              COUNT(*) FILTER (WHERE usability = 'usable') AS usable,
              COUNT(*) FILTER (WHERE usability = 'unusable') AS unusable,
              COALESCE(SUM(quantity_affected) FILTER (WHERE usability = 'unusable' AND component_id IS NULL), 0) AS unusable_qty
       FROM item_faults WHERE status = 'open' GROUP BY item_id`
    )
    const byItem = {}
    let open = 0, usable = 0, unusable = 0
    for (const r of rows) {
      byItem[r.item_id] = {
        open: Number(r.open), usable: Number(r.usable), unusable: Number(r.unusable), unusableQty: Number(r.unusable_qty),
      }
      open += Number(r.open); usable += Number(r.usable); unusable += Number(r.unusable)
    }
    res.json({ open, usable, unusable, itemsAffected: rows.length, byItem })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load fault summary' })
  }
})

router.get('/', async (req, res) => {
  try {
    const status = String(req.query.status || 'open')
    const usability = String(req.query.usability || '')
    if (!['open', 'resolved', 'all'].includes(status)) return bad(res, 'Unknown status')
    if (usability && !USABILITY.includes(usability)) return bad(res, 'Unknown usability')
    const where = []
    const args = []
    if (status !== 'all') { args.push(status); where.push(`f.status = $${args.length}`) }
    if (usability) { args.push(usability); where.push(`f.usability = $${args.length}`) }
    if (req.query.itemId) {
      if (!isUuid(String(req.query.itemId))) return bad(res, 'Invalid item id')
      args.push(req.query.itemId); where.push(`f.item_id = $${args.length}`)
    }
    const search = clean(Array.isArray(req.query.search) ? req.query.search[0] : req.query.search)
    if (search) {
      args.push(`%${search.slice(0, 200)}%`)
      const n = args.length
      where.push(`(i.name ILIKE $${n} OR i.sku ILIKE $${n} OR f.description ILIKE $${n} OR kc.name ILIKE $${n}
        OR f.found_with ILIKE $${n} OR f.workaround ILIKE $${n})`)
    }
    const W = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const lim = Math.min(200, Math.max(1, Number(req.query.limit) || 25))
    const page = Math.max(1, Number(req.query.page) || 1)
    const base = `FROM item_faults f JOIN items i ON i.id = f.item_id LEFT JOIN kit_components kc ON kc.id = f.component_id ${W}`
    const total = Number((await query(`SELECT COUNT(*) ${base}`, args)).rows[0].count)
    const { rows } = await query(
      `${SELECT} ${W}
       ORDER BY (f.status = 'open') DESC, (f.usability = 'unusable') DESC, f.reported_at DESC, f.id
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, lim, (page - 1) * lim]
    )
    const c = (await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open') AS open,
              COUNT(*) FILTER (WHERE status = 'open' AND usability = 'usable') AS usable,
              COUNT(*) FILTER (WHERE status = 'open' AND usability = 'unusable') AS unusable,
              COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
       FROM item_faults`
    )).rows[0]
    res.json({
      faults: rows.map(map), total, page, limit: lim,
      summary: { open: Number(c.open), usable: Number(c.usable), unusable: Number(c.unusable), resolved: Number(c.resolved) },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load faults' })
  }
})

router.post('/', async (req, res) => {
  try {
    if (!isUuid(req.body?.itemId)) return bad(res, 'Choose an item')
    const item = await query('SELECT id FROM items WHERE id = $1', [req.body.itemId])
    if (!item.rows.length) return res.status(404).json({ error: 'Item not found' })
    const { error, value: v } = await readBody(req.body, req.body.itemId)
    if (error) return bad(res, error)
    const { rows } = await query(
      `INSERT INTO item_faults (item_id, component_id, description, usability, workaround, quantity_affected, found_with, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.body.itemId, v.componentId, v.description, v.usability, v.workaround, v.qty, v.foundWith, req.user?.name || 'Unknown']
    )
    res.status(201).json(await fetchOne(rows[0].id))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to report fault' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const cur = await query('SELECT item_id FROM item_faults WHERE id = $1', [req.params.id])
    if (!cur.rows.length) return res.status(404).json({ error: 'Fault not found' })
    const { error, value: v } = await readBody(req.body || {}, cur.rows[0].item_id)
    if (error) return bad(res, error)
    await query(
      `UPDATE item_faults SET component_id = $2, description = $3, usability = $4, workaround = $5,
              quantity_affected = $6, found_with = $7, updated_at = NOW() WHERE id = $1`,
      [req.params.id, v.componentId, v.description, v.usability, v.workaround, v.qty, v.foundWith]
    )
    res.json(await fetchOne(req.params.id))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to update fault' })
  }
})

router.post('/:id/resolve', async (req, res) => {
  try {
    const resolution = req.body?.resolution
    if (!RESOLUTIONS.includes(resolution)) return bad(res, 'Choose how it was resolved')
    const notes = clean(req.body?.notes)
    if (notes && notes.length > 1000) return bad(res, 'Notes must be 1000 characters or fewer')
    const r = await query(
      `UPDATE item_faults SET status = 'resolved', resolution = $2, resolution_notes = $3,
              resolved_by = $4, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'open' RETURNING id`,
      [req.params.id, resolution, notes || null, req.user?.name || 'Unknown']
    )
    if (!r.rows.length) {
      const exists = await query('SELECT 1 FROM item_faults WHERE id = $1', [req.params.id])
      return exists.rows.length ? bad(res, 'This fault is already resolved') : res.status(404).json({ error: 'Fault not found' })
    }
    res.json(await fetchOne(req.params.id))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to resolve fault' })
  }
})

router.post('/:id/reopen', async (req, res) => {
  try {
    const r = await query(
      `UPDATE item_faults SET status = 'open', resolution = NULL, resolution_notes = NULL,
              resolved_by = NULL, resolved_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'resolved' RETURNING id`,
      [req.params.id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'No resolved fault with that id' })
    res.json(await fetchOne(req.params.id))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to reopen fault' })
  }
})

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const r = await query('DELETE FROM item_faults WHERE id = $1 RETURNING id', [req.params.id])
    if (!r.rows.length) return res.status(404).json({ error: 'Fault not found' })
    res.status(204).end()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to delete fault' })
  }
})

export default router
