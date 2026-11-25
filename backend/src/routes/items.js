import { Router } from 'express'
import { query, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { requireSite, siteItemParam } from '../middleware/site.js'
import { uuidParam, isUuid, intParam, escapeLike } from '../middleware/validate.js'
import { syncComponents, repackKit, repackableSets, setTotalSets, ownedSetsFrom, HttpError } from '../services/kits.js'
import { syncItemUnits, tidyQty, QTY_EPSILON, roundQty, snapToGrid, stockGrid } from '../services/itemUnits.js'
import { ensureCategory, syncCategoriesFromItems, listCategories } from '../services/categories.js'

const ITEM_TYPES = ['consumable', 'reusable', 'kit']

const router = Router()
router.use(authenticate, requireSite)
router.param('id', uuidParam)
// an item of another site answers 404, for every role (see middleware/site.js)
router.param('id', siteItemParam)

function mapComponent(kit, c) {
  const perKit = c.quantity_per_kit
  return {
    id: c.id,
    name: c.name,
    quantityPerKit: perKit,
    notes: c.notes,
    position: c.position,
    // pieces sitting outside a complete set
    loose: c.loose_quantity,
    // everything of this piece that is in store (inside complete sets + loose)
    available: Number(kit.quantity) * perKit + c.loose_quantity,
    // pieces currently out with recipients and not yet returned
    outstanding: Number(c.outstanding || 0),
  }
}

function mapItem(r, comps = []) {
  const components = comps.map((c) => mapComponent(r, c))
  // Kits: sets owned in total = complete sets on the shelf + sets opened + sets issued out
  // (a set with some pieces issued is neither "on the shelf" nor a whole set "out").
  const totalSets = r.item_type === 'kit'
    ? ownedSetsFrom(r.quantity, r.outstanding || 0,
        components.map((c) => ({ perKit: c.quantityPerKit, inStore: c.available, out: c.outstanding })))
    : null
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    category: r.category,
    quantity: tidyQty(r.quantity),
    // Currently out on issue and expected back (reusable / kit only)
    outstanding: tidyQty(r.outstanding || 0),
    // Available (in stock) + outstanding (issued, not yet returned).
    // Kits use the sets-owned figure, which also counts opened sets and pieces that are out.
    totalQuantity: totalSets != null ? totalSets : tidyQty(Number(r.quantity) + Number(r.outstanding || 0)),
    baseUnitId: r.base_unit_id,
    // True once the item has any ledger line; its base unit can no longer be changed then
    hasHistory: !!r.has_history,
    // Units this item can be received / issued / returned in (base unit always first)
    unitIds: [...new Set([r.base_unit_id, ...(r.unit_ids || [])].filter(Boolean))],
    // Base units per ONE of each allowed unit, for this item (base unit = 1)
    // Units that were set as "N per base unit" use the exact inverse (1/48), not a rounded decimal.
    unitFactors: {
      ...Object.fromEntries(Object.entries(r.unit_factors || {}).map(([k, v]) => [k, Number(v)])),
      ...Object.fromEntries(Object.entries(r.units_per_base || {}).map(([k, v]) => [k, 1 / Number(v)])),
      [r.base_unit_id]: 1,
    },
    // How many of a unit make ONE base unit, for units set up that way (e.g. Piece: 48 per pack)
    unitsPerBase: Object.fromEntries(Object.entries(r.units_per_base || {}).map(([k, v]) => [k, Number(v)])),
    reorderLevel: Number(r.reorder_level),
    location: r.location,
    itemType: r.item_type,
    piecesPerSet: r.pieces_per_set != null ? Number(r.pieces_per_set) : null,
    kitNotes: r.kit_notes,
    // Kit contents (empty for non-kits). `quantity` of a kit = complete sets in store.
    components,
    componentPieces: components.reduce((n, c) => n + c.quantityPerKit, 0),
    loosePieces: components.reduce((n, c) => n + c.loose, 0),
    // Individual pieces currently out with recipients (whole sets issued are included, since
    // every set line also logs its pieces). `outstanding` above counts whole sets only.
    piecesOut: components.reduce((n, c) => n + c.outstanding, 0),
    // Sets owned in total = complete sets on the shelf + opened + issued out (kits only).
    // This is the number the Edit Item form shows and asks for.
    totalSets,
    repackableSets: repackableSets(comps),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/**
 * Items joined with the quantity currently issued out and not yet returned.
 * Computed per recipient (capped at 0) so it matches the return flow.
 * Consumables are used up rather than expected back, so they always show 0 outstanding
 * (they can still be returned – see services/returns.js).
 */
const ITEM_SELECT = `
  SELECT i.*,
         CASE WHEN i.item_type = 'consumable' THEN 0 ELSE COALESCE((
           SELECT SUM(GREATEST(0, bal)) FROM (
             SELECT SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
                  - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) AS bal
             FROM transactions t
             WHERE t.item_id = i.id
               AND t.recipient IS NOT NULL AND t.recipient <> ''
               AND t.component_id IS NULL
             GROUP BY t.recipient, COALESCE(t.department, '')
           ) per_recipient
         ), 0) END AS outstanding,
         EXISTS (SELECT 1 FROM transactions h WHERE h.item_id = i.id) AS has_history,
         COALESCE((SELECT array_agg(iu.unit_id::text) FROM item_units iu WHERE iu.item_id = i.id), '{}') AS unit_ids,
         COALESCE((SELECT json_object_agg(iu.unit_id::text, COALESCE(iu.conversion_factor, u.conversion_factor))
                   FROM item_units iu JOIN units u ON u.id = iu.unit_id
                   WHERE iu.item_id = i.id), '{}'::json) AS unit_factors,
         COALESCE((SELECT json_object_agg(iu.unit_id::text, iu.units_per_base)
                   FROM item_units iu
                   WHERE iu.item_id = i.id AND iu.units_per_base IS NOT NULL), '{}'::json) AS units_per_base
  FROM items i
`

/** Active components (with what is out on issue) for a set of kit ids, grouped by kit. */
async function loadComponents(db, kitIds) {
  const byKit = new Map()
  if (!kitIds.length) return byKit
  const { rows } = await db(
    `SELECT c.*, COALESCE(o.outstanding, 0) AS outstanding
     FROM kit_components c
     LEFT JOIN (
       SELECT component_id, SUM(GREATEST(0, bal)) AS outstanding
       FROM (
         SELECT component_id,
                SUM(CASE WHEN type = 'issue' THEN quantity ELSE 0 END)
                  - SUM(CASE WHEN type = 'return' THEN quantity ELSE 0 END) AS bal
         FROM transactions
         WHERE component_id IN (SELECT id FROM kit_components WHERE kit_id = ANY($1))
           AND recipient IS NOT NULL AND recipient <> ''
         GROUP BY component_id, recipient, COALESCE(department, '')
       ) per_recipient
       GROUP BY component_id
     ) o ON o.component_id = c.id
     WHERE c.kit_id = ANY($1) AND c.is_active
     ORDER BY c.position, c.name`,
    [kitIds]
  )
  for (const c of rows) {
    if (!byKit.has(c.kit_id)) byKit.set(c.kit_id, [])
    byKit.get(c.kit_id).push(c)
  }
  return byKit
}

async function mapItems(rows) {
  const kitIds = rows.filter((r) => r.item_type === 'kit').map((r) => r.id)
  const comps = await loadComponents(query, kitIds)
  return rows.map((r) => mapItem(r, comps.get(r.id) || []))
}

async function fetchItem(id) {
  const { rows } = await query(`${ITEM_SELECT} WHERE i.id = $1`, [id])
  return rows[0] ? (await mapItems(rows))[0] : null
}

function sendError(res, e, fallback) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
  if (e.code === '23505') return res.status(409).json({ error: 'SKU or component name already exists' })
  // a value that does not fit its column is the caller's mistake, not a server fault
  if (e.code === '22001') return res.status(400).json({ error: 'One of the values is too long' })
  if (e.code === '22003') return res.status(400).json({ error: 'One of the numbers is too large' })
  console.error(e)
  return res.status(500).json({ error: fallback })
}

router.get('/', async (req, res) => {
  try {
    const { search, category, itemType, lowStock } = req.query
    const conditions = ['i.site_id = $1']
    const params = [req.siteId]
    let i = 2
    if (typeof search === 'string' && search.trim()) {
      // `%` and `_` typed by a person are matched literally (they used to act as wildcards)
      conditions.push(`(i.name ILIKE $${i} OR i.sku ILIKE $${i} OR i.category ILIKE $${i} OR i.location ILIKE $${i}
        OR EXISTS (SELECT 1 FROM kit_components kc WHERE kc.kit_id = i.id AND kc.is_active AND kc.name ILIKE $${i}))`)
      params.push(`%${escapeLike(search.trim().slice(0, 200))}%`)
      i++
    }
    if (typeof category === 'string' && category) {
      conditions.push(`lower(btrim(i.category)) = lower($${i++})`)
      params.push(category)
    }
    if (typeof itemType === 'string' && itemType) {
      if (!ITEM_TYPES.includes(itemType)) return res.status(400).json({ error: 'Invalid item type' })
      conditions.push(`i.item_type = $${i++}`)
      params.push(itemType)
    }
    // "?lowStock=false" used to count as true (any non-empty text is truthy)
    if (['1', 'true', 'yes'].includes(String(lowStock ?? '').toLowerCase())) conditions.push('i.quantity <= i.reorder_level')
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const lim = intParam(req.query.limit, { fallback: 50, min: 1, max: 1000 })
    const pageNum = intParam(req.query.page, { fallback: 1, min: 1, max: 1e6 })
    const offset = (pageNum - 1) * lim
    const countRes = await query(`SELECT COUNT(*) FROM items i ${where}`, params)
    const { rows } = await query(
      `${ITEM_SELECT} ${where} ORDER BY i.name ASC, i.id ASC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, lim, offset]
    )
    res.json({
      items: await mapItems(rows),
      total: Number(countRes.rows[0].count),
      page: pageNum,
      limit: lim,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch items' })
  }
})

/** Dashboard numbers, computed in SQL so the browser never needs the whole ledger. */
router.get('/stats', async (req, res) => {
  try {
    const [itemsRes, txnRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total, COALESCE(SUM(quantity), 0) AS stock,
                    COUNT(*) FILTER (WHERE quantity <= reorder_level) AS low
             FROM items WHERE site_id = $1`, [req.siteId]),
      query(`SELECT COUNT(*) FILTER (WHERE parent_txn_id IS NULL) AS total,
                    COUNT(*) FILTER (WHERE parent_txn_id IS NULL AND type = 'receive') AS receives,
                    COUNT(*) FILTER (WHERE parent_txn_id IS NULL AND type = 'issue') AS issues
             FROM transactions
             WHERE item_id IN (SELECT id FROM items WHERE site_id = $1)`, [req.siteId]),
    ])
    const i = itemsRes.rows[0]
    const t = txnRes.rows[0]
    res.json({
      totalItems: Number(i.total),
      totalStock: Number(i.stock),
      lowStockCount: Number(i.low),
      transactionCount: Number(t.total),
      receiveCount: Number(t.receives),
      issueCount: Number(t.issues),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load stats' })
  }
})

/**
 * Category names, for the dropdowns (kept for browsers still running an older page).
 * Now served from the managed list, so categories created without items show up too.
 */
router.get('/categories', async (_req, res) => {
  try {
    await syncCategoriesFromItems()
    res.json((await listCategories()).map((c) => c.name))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
})

/**
 * Next free SKU for a category, in the same style as the existing ones (CLN-001, STN-002 ...).
 * Re-uses the prefix already used by that category's items; otherwise the first three
 * letters of the category. Runs inside the create transaction under an advisory lock so
 * two simultaneous creates cannot be handed the same number.
 */
async function generateSku(db, category, siteId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('items_sku_generate'))")
  let prefix
  const { rows } = await db.query(
    `SELECT substring(sku from '^(.*)-[0-9]+$') AS p, COUNT(*) AS n
     FROM items WHERE site_id = $2 AND lower(btrim(category)) = lower($1) AND sku ~ '^.+-[0-9]+$'
     GROUP BY p ORDER BY n DESC LIMIT 1`,
    [category, siteId]
  )
  prefix = rows[0]?.p
  if (!prefix) {
    prefix = String(category).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3).padEnd(3, 'X') || 'ITM'
  }
  const like = `${prefix.replace(/[\\%_]/g, (m) => '\\' + m)}-%`
  const { rows: taken } = await db.query('SELECT sku FROM items WHERE site_id = $2 AND sku ILIKE $1', [like, siteId])
  let n = 1
  for (const { sku } of taken) {
    const m = /-(\d+)$/.exec(sku)
    if (m && sku.slice(0, sku.lastIndexOf('-')).toLowerCase() === prefix.toLowerCase()) {
      n = Math.max(n, Number(m[1]) + 1)
    }
  }
  // the number could still collide with a differently-formatted SKU; skip ahead until free
  for (;;) {
    const sku = `${prefix}-${String(n).padStart(3, '0')}`
    const { rowCount } = await db.query('SELECT 1 FROM items WHERE site_id = $2 AND lower(sku) = lower($1)', [sku, siteId])
    if (!rowCount) return sku
    n++
  }
}

router.get('/:id', async (req, res) => {
  try {
    const item = await fetchItem(req.params.id)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    res.json(item)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch item' })
  }
})

// items.quantity is NUMERIC(22,10); stay far inside it (the bulk screens use the same ceiling)
const MAX_QTY = 1e9

function validateItemBody(b, { skuOptional = false } = {}) {
  if (!skuOptional && !String(b.sku || '').trim()) return 'SKU is required'
  if (String(b.sku || '').length > 50) return 'SKU must be 50 characters or fewer'
  if (!String(b.name || '').trim()) return 'Name is required'
  if (String(b.name).trim().length > 200) return 'Name must be 200 characters or fewer'
  if (String(b.location || '').length > 100) return 'Location must be 100 characters or fewer'
  if (!String(b.category || '').trim()) return 'Category is required'
  if (String(b.category).trim().length > 100) return 'Category must be 100 characters or fewer'
  if (!isUuid(b.baseUnitId)) return 'A base unit is required'
  const q = Number(b.quantity ?? 0)
  if (!Number.isFinite(q) || q < 0) return 'Quantity must be 0 or more'
  if (q > MAX_QTY) return 'Quantity is too large'
  const r = Number(b.reorderLevel ?? 0)
  if (!Number.isFinite(r) || r < 0) return 'Reorder level must be 0 or more'
  if (r > MAX_QTY) return 'Reorder level is too large'
  if (b.itemType && !ITEM_TYPES.includes(b.itemType)) return 'Invalid item type'
  if (b.piecesPerSet !== undefined && b.piecesPerSet !== null && b.piecesPerSet !== '') {
    const n = Number(b.piecesPerSet)
    if (!Number.isInteger(n) || n < 1 || n > 100000) return 'Pieces per set must be a whole number of 1 or more'
  }
  return null
}

router.post('/', async (req, res) => {
  try {
    const invalid = validateItemBody(req.body, { skuOptional: true })
    if (invalid) return res.status(400).json({ error: invalid })
    const {
      sku: skuInput, name, description, category, quantity, baseUnitId,
      reorderLevel, location, itemType, piecesPerSet, kitNotes, components, unitIds, unitFactors, unitsPerBase,
    } = req.body
    const type = itemType || 'consumable'
    const id = await withTransaction(async (client) => {
      const cat = await ensureCategory(client, category)
      const sku = String(skuInput || '').trim() || (await generateSku(client, cat, req.siteId))
      const { rows } = await client.query(
        `INSERT INTO items (sku, name, description, category, quantity, base_unit_id, reorder_level, location, item_type, pieces_per_set, kit_notes, site_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          sku, name.trim(), description || '', cat, quantity || 0, baseUnitId,
          reorderLevel || 0, location || '', type,
          piecesPerSet || null, kitNotes || null, req.siteId,
        ]
      )
      await syncItemUnits(client, rows[0].id, baseUnitId, unitIds, unitFactors, unitsPerBase)
      if (type === 'kit' && Array.isArray(components)) {
        await syncComponents(client, rows[0].id, components)
      }
      return rows[0].id
    })
    res.status(201).json(await fetchItem(id))
  } catch (e) {
    if (e.code === '23505' && String(e.constraint || '').includes('sku')) {
      return res.status(409).json({ error: 'SKU already exists' })
    }
    sendError(res, e, 'Failed to create item')
  }
})

// Editing an item (name, SKU, units, stock figures, kit contents…) is an admin task. Staff keep the
// day-to-day actions: add item, issue, receive, return, repack.
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const invalid = validateItemBody(req.body)
    if (invalid) return res.status(400).json({ error: invalid })
    const {
      sku, name, description, category, quantity, baseUnitId,
      reorderLevel, location, piecesPerSet, kitNotes, components, unitIds, unitFactors, unitsPerBase, totalSets,
      totalQuantity,
    } = req.body
    const found = await withTransaction(async (client) => {
      const cat = await ensureCategory(client, category)
      const cur = await client.query('SELECT base_unit_id, item_type FROM items WHERE id=$1 FOR UPDATE', [req.params.id])
      if (!cur.rows.length) return false
      // A request that leaves itemType out keeps the item's current type. It used to be treated as
      // "consumable", which silently turned a kit into a consumable and archived its component list.
      const itemType = req.body.itemType || cur.rows[0].item_type
      // Stock is stored in the base unit and every ledger line / conversion factor is relative
      // to it, so it can only be switched while the item has no history.
      if (cur.rows[0].base_unit_id && cur.rows[0].base_unit_id !== baseUnitId) {
        const used = await client.query('SELECT 1 FROM transactions WHERE item_id=$1 LIMIT 1', [req.params.id])
        if (used.rows.length) {
          throw new HttpError(409, "This item already has stock history, so its base unit can't be changed.")
        }
      }
      // Non-kit items: the Edit form works with the TOTAL owned (in store + out with people), the
      // same figure the Inventory list shows. The stock column holds only what is in store, so
      // it is derived here, inside the row lock, from what is out right now. This keeps the edit
      // correct even if items were issued / returned while the form was open.
      let storeQty = quantity === undefined || quantity === null || quantity === '' ? null : Number(quantity)
      if (itemType !== 'kit' && totalQuantity !== undefined && totalQuantity !== null && totalQuantity !== '') {
        const total = Number(totalQuantity)
        if (!Number.isFinite(total) || total < 0) throw new HttpError(400, 'Total quantity must be 0 or more')
        const out = await client.query(
          `SELECT COALESCE(SUM(GREATEST(0, bal)), 0) AS outstanding FROM (
             SELECT SUM(CASE WHEN type = 'issue' THEN quantity ELSE 0 END)
                  - SUM(CASE WHEN type = 'return' THEN quantity ELSE 0 END) AS bal
             FROM transactions
             WHERE item_id = $1 AND recipient IS NOT NULL AND recipient <> '' AND component_id IS NULL
             GROUP BY recipient, COALESCE(department, '')
           ) per_recipient`,
          [req.params.id]
        )
        const outstanding = tidyQty(out.rows[0].outstanding || 0)
        if (total + QTY_EPSILON < outstanding) {
          throw new HttpError(
            409,
            `${outstanding} of this item ${outstanding === 1 ? 'is' : 'are'} currently issued out, so the total can't be less than ${outstanding}. Return the stock first, or enter ${outstanding} or more.`
          )
        }
        storeQty = Math.max(0, roundQty(total - outstanding))
      }
      // keep the stock exactly on the item's smallest-unit grid (e.g. whole pieces of a pack-counted item)
      if (storeQty !== null && Number.isFinite(storeQty)) {
        storeQty = snapToGrid(storeQty, await stockGrid(client, req.params.id))
      }
      const { rows } = await client.query(
        `UPDATE items SET
           sku=$1, name=$2, description=$3, category=$4, quantity=COALESCE($5, quantity),
           base_unit_id=$6, reorder_level=$7, location=$8, item_type=$9,
           pieces_per_set=$10, kit_notes=$11, updated_at=NOW()
         WHERE id=$12 RETURNING id`,
        [
          sku.trim(), name.trim(), description || '', cat,
          storeQty, baseUnitId,
          reorderLevel ?? 0, location || '', itemType, piecesPerSet || null, kitNotes || null,
          req.params.id,
        ]
      )
      if (!rows.length) return false
      await syncItemUnits(client, rows[0].id, baseUnitId, unitIds, unitFactors, unitsPerBase)
      if (itemType === 'kit') {
        if (Array.isArray(components)) await syncComponents(client, rows[0].id, components)
        // New form: the person enters the TOTAL sets owned; the complete sets on the shelf follow.
        if (totalSets !== undefined && totalSets !== null && totalSets !== '') {
          await setTotalSets(client, rows[0].id, totalSets)
        }
      } else {
        // no longer a kit: drop/archive its components (refused while pieces are out)
        await syncComponents(client, rows[0].id, [])
      }
      return true
    })
    if (!found) return res.status(404).json({ error: 'Item not found' })
    res.json(await fetchItem(req.params.id))
  } catch (e) {
    if (e.code === '23505' && String(e.constraint || '').includes('sku')) {
      return res.status(409).json({ error: 'SKU already exists' })
    }
    sendError(res, e, 'Failed to update item')
  }
})

/** Turn loose pieces back into complete sets. Body: { sets? } (default: as many as possible). */
router.post('/:id/repack', async (req, res) => {
  try {
    const n = await withTransaction((client) => repackKit(client, req.params.id, req.body?.sets))
    const item = await fetchItem(req.params.id)
    res.json({ repacked: n, item })
  } catch (e) {
    sendError(res, e, 'Failed to repack kit')
  }
})

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const cur = await client.query('SELECT item_type FROM items WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!cur.rows.length) return { status: 404, error: 'Item not found' }
      // Deleting an item also deletes its whole ledger. If some of it is still out with people,
      // that would erase the only record of who has it, so it has to come back first.
      // (Consumables are used up, not expected back, so they are never "out".)
      if (cur.rows[0].item_type !== 'consumable') {
        const out = await client.query(
          `SELECT COALESCE(SUM(GREATEST(0, bal)), 0) AS out FROM (
             SELECT SUM(CASE WHEN type = 'issue' THEN quantity ELSE 0 END)
                  - SUM(CASE WHEN type = 'return' THEN quantity ELSE 0 END) AS bal
             FROM transactions
             WHERE item_id = $1 AND recipient IS NOT NULL AND recipient <> ''
             GROUP BY component_id, recipient, COALESCE(department, '')
           ) x`,
          [req.params.id]
        )
        if (Number(out.rows[0].out) > QTY_EPSILON) {
          return {
            status: 409,
            error: 'This item is still issued out to people. Return it first – deleting it would erase the record of who has it.',
          }
        }
      }
      await client.query('DELETE FROM items WHERE id = $1', [req.params.id])
      return { status: 204 }
    })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.status(204).end()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to delete item' })
  }
})

export default router
