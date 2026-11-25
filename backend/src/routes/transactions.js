import { Router } from 'express'
import { query, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { requireSite, siteItemParam, assertItemsInSite, assertEventInSite } from '../middleware/site.js'
import { uuidParam, isUuid, clean, intParam, isCalendarDate, escapeLike } from '../middleware/validate.js'
import { mapTxn } from '../services/mappers.js'
import {
  HttpError, activeComponentCount, issueWholeKit, issuePieces, returnKit, receivePieces,
} from '../services/kits.js'
import { resolveUnitFactor, applyStockDelta, roundQty, QTY_EPSILON } from '../services/itemUnits.js'
import { returnableBalance, returnEverything, resolveReturnAttribution } from '../services/returns.js'
import { listOutstanding } from '../services/outstanding.js'
import { ensureRecipient } from '../services/recipients.js'
import { bulkIssue, bulkReceive } from '../services/bulk.js'
import { runOnce } from '../services/idempotency.js'

const router = Router()
router.use(authenticate, requireSite)
router.param('id', uuidParam)
router.param('itemId', uuidParam)
// an item of another site answers 404, for every role (see middleware/site.js)
router.param('itemId', siteItemParam)

router.get('/', async (req, res) => {
  try {
    const { itemId, eventId, type, from, to, topLevel, withTotal, search } = req.query
    if ((itemId && !isUuid(itemId)) || (eventId && !isUuid(eventId))) {
      return res.status(400).json({ error: 'Invalid id' })
    }
    if (type && !['receive', 'issue', 'return'].includes(type)) {
      return res.status(400).json({ error: 'Invalid transaction type' })
    }
    // from / to are calendar days; anything else used to reach the database and come back as a 500
    for (const [label, v] of [['from', from], ['to', to]]) {
      if (v && !isCalendarDate(String(v))) return res.status(400).json({ error: `"${label}" must be a date (YYYY-MM-DD)` })
    }
    const conditions = ['t.item_id IN (SELECT id FROM items WHERE site_id = $1)']
    const params = [req.siteId]
    let i = 2
    if (itemId) { conditions.push(`t.item_id = $${i++}`); params.push(itemId) }
    if (eventId) { conditions.push(`t.event_id = $${i++}`); params.push(eventId) }
    if (type) { conditions.push(`t.type = $${i++}`); params.push(type) }
    if (from) { conditions.push(`t.created_at >= $${i++}`); params.push(from) }
    if (to) { conditions.push(`t.created_at <= $${i++}`); params.push(to + ' 23:59:59') }
    if (topLevel) conditions.push('t.parent_txn_id IS NULL')
    // Optional free-text filter (item name / SKU / piece / vendor / recipient / notes / who recorded it).
    // `%`, `_` and `\` are escaped so they match literally.
    const term = typeof search === 'string' ? search.trim().slice(0, 100) : ''
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`
      conditions.push(
        `(EXISTS (SELECT 1 FROM items si WHERE si.id = t.item_id AND (si.name ILIKE $${i} OR si.sku ILIKE $${i}))
          OR EXISTS (SELECT 1 FROM kit_components sk WHERE sk.id = t.component_id AND sk.name ILIKE $${i})
          OR t.vendor ILIKE $${i} OR t.recipient ILIKE $${i} OR t.notes ILIKE $${i} OR t.performed_by ILIKE $${i})`
      )
      params.push(like)
      i++
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const lim = intParam(req.query.limit, { fallback: 100, min: 1, max: 2000 })
    const off = intParam(req.query.offset, { fallback: 0, min: 0, max: 1e9 })
    const { rows } = await query(
      `SELECT t.*, kc.name AS component_name
       FROM transactions t LEFT JOIN kit_components kc ON kc.id = t.component_id
       ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, lim, off]
    )
    // Default response stays a plain array so existing callers are unaffected.
    // With ?withTotal=1 the response is { transactions, total, limit, offset } for server-side paging.
    if (withTotal && withTotal !== '0' && withTotal !== 'false') {
      const countRes = await query(`SELECT COUNT(*) FROM transactions t ${where}`, params)
      return res.json({
        transactions: rows.map(mapTxn),
        total: Number(countRes.rows[0].count),
        limit: lim,
        offset: off,
      })
    }
    res.json(rows.map(mapTxn))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

/**
 * Everything issued out on a given calendar day.
 * GET /api/transactions/daily?date=YYYY-MM-DD&tz=Area/City
 * `tz` is the viewer's IANA time zone so "a day" matches their local day.
 */
router.get('/daily', async (req, res) => {
  try {
    const { date, tz = 'UTC' } = req.query
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' })
    }
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ error: 'date is not a valid calendar day' })
    }
    const tzCheck = await query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [tz])
    if (!tzCheck.rows.length) {
      return res.status(400).json({ error: 'Unknown time zone' })
    }

    const { rows } = await query(
      `SELECT t.*,
              i.name AS item_name, i.sku AS item_sku, i.item_type,
              u.abbreviation AS unit_abbr,
              bu.abbreviation AS base_unit_abbr,
              e.name AS event_name,
              kc.name AS component_name
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       LEFT JOIN kit_components kc ON kc.id = t.component_id
       LEFT JOIN units u ON u.id = t.unit_id
       LEFT JOIN units bu ON bu.id = i.base_unit_id
       LEFT JOIN events e ON e.id = t.event_id
       WHERE t.type = 'issue'
         AND t.created_at >= ($1::date)::timestamp AT TIME ZONE $2
         AND t.created_at <  (($1::date + 1))::timestamp AT TIME ZONE $2
         AND i.site_id = $3
       ORDER BY t.created_at DESC, t.parent_txn_id NULLS FIRST, kc.position`,
      [date, tz, req.siteId]
    )

    res.json({
      date,
      timezone: tz,
      entries: rows.map((r) => ({
        ...mapTxn(r),
        itemName: r.item_name,
        itemSku: r.item_sku,
        itemType: r.item_type,
        unitAbbr: r.unit_abbr,
        baseUnitAbbr: r.base_unit_abbr,
        eventName: r.event_name,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch daily issues' })
  }
})

/**
 * Everything that is out, across all items, grouped by person or by item (Return Stock page).
 * GET /api/transactions/outstanding?type=expected|consumable|all&groupBy=recipient|item
 *     &search=&days=&page=&limit=
 */
router.get('/outstanding', async (req, res) => {
  try {
    res.json(await listOutstanding({ ...req.query, siteId: req.siteId }))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch outstanding stock' })
  }
})

/**
 * Outstanding balances by recipient for an item (for return flow).
 * GET /api/transactions/outstanding/:itemId?search=&page=&limit=
 */
router.get('/outstanding/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : ''
    const page = intParam(req.query.page, { fallback: 1, min: 1, max: 1e6 })
    const limit = intParam(req.query.limit, { fallback: 10, min: 1, max: 50 })

    const typeRes = await query('SELECT item_type FROM items WHERE id = $1', [itemId])
    const itemType = typeRes.rows[0]?.item_type
    if (itemType === 'kit') {
      return res.json(await kitOutstanding(itemId, search, page, limit))
    }

    const params = [itemId]
    let searchClause = ''
    if (search) {
      params.push(`%${escapeLike(search)}%`)
      searchClause = `AND (recipient ILIKE $2 OR department ILIKE $2)`
    }

    const baseSql = `
      FROM (
        SELECT
          COALESCE(recipient, 'Unknown') AS recipient,
          COALESCE(department, '') AS department,
          SUM(CASE WHEN type = 'issue' THEN quantity ELSE 0 END)
            - SUM(CASE WHEN type = 'return' THEN quantity ELSE 0 END) AS outstanding,
          MAX(created_at) FILTER (WHERE type = 'issue') AS last_issued
        FROM transactions
        WHERE item_id = $1
          AND component_id IS NULL
          AND recipient IS NOT NULL
          AND recipient <> ''
        GROUP BY COALESCE(recipient, 'Unknown'), COALESCE(department, '')
      ) bal
      WHERE outstanding > 0.000001
      ${search ? `AND (recipient ILIKE $2 OR department ILIKE $2)` : ''}
    `

    const countRes = await query(`SELECT COUNT(*) ${baseSql}`, params)
    const total = Number(countRes.rows[0].count)
    const pageNum = page
    const lim = limit
    const offset = (pageNum - 1) * lim

    const { rows } = await query(
      `SELECT recipient, department, outstanding, last_issued
       ${baseSql}
       ORDER BY ${itemType === 'consumable' ? 'last_issued DESC NULLS LAST, recipient ASC' : 'outstanding DESC, recipient ASC'}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, offset]
    )

    res.json({
      balances: rows.map((r) => ({
        recipient: r.recipient,
        department: r.department,
        outstanding: Math.round(Number(r.outstanding) * 1e8) / 1e8,
        lastIssuedAt: r.last_issued,
      })),
      total,
      page: pageNum,
      limit: lim,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch outstanding balances' })
  }
})


/**
 * Outstanding balances for a kit, per recipient: complete sets still out, plus every
 * component piece still out (so someone who only borrowed a screwdriver shows up too).
 */
async function kitOutstanding(itemId, search, pageNum, limit) {
  const [setsRes, compRes, defRes] = await Promise.all([
    query(
      `SELECT recipient, COALESCE(department,'') AS department,
              SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END)
            - SUM(CASE WHEN type='return' THEN quantity ELSE 0 END) AS bal
       FROM transactions
       WHERE item_id=$1 AND component_id IS NULL AND recipient IS NOT NULL AND recipient <> ''
       GROUP BY recipient, COALESCE(department,'')`,
      [itemId]
    ),
    query(
      `SELECT t.recipient, COALESCE(t.department,'') AS department, t.component_id,
              SUM(CASE WHEN t.type='issue' THEN t.quantity ELSE 0 END)
            - SUM(CASE WHEN t.type='return' THEN t.quantity ELSE 0 END) AS bal
       FROM transactions t
       WHERE t.item_id=$1 AND t.component_id IS NOT NULL AND t.recipient IS NOT NULL AND t.recipient <> ''
       GROUP BY t.recipient, COALESCE(t.department,''), t.component_id`,
      [itemId]
    ),
    query(
      `SELECT id, name, quantity_per_kit, is_active FROM kit_components
       WHERE kit_id=$1 ORDER BY position, name`,
      [itemId]
    ),
  ])
  const defs = new Map(defRes.rows.map((c) => [c.id, c]))
  const map = new Map()
  const row = (recipient, department) => {
    const key = `${recipient}\u0000${department}`
    if (!map.has(key)) map.set(key, { recipient, department, outstanding: 0, components: [] })
    return map.get(key)
  }
  for (const r of setsRes.rows) {
    if (Number(r.bal) > 0) row(r.recipient, r.department).outstanding = Number(r.bal)
  }
  for (const r of compRes.rows) {
    const bal = Number(r.bal)
    const d = defs.get(r.component_id)
    if (bal > 0 && d) {
      row(r.recipient, r.department).components.push({
        componentId: r.component_id,
        name: d.name,
        quantityPerKit: d.quantity_per_kit,
        outstanding: bal,
        position: [...defs.keys()].indexOf(r.component_id),
      })
    }
  }
  const q = String(search || '').toLowerCase()
  let list = [...map.values()].filter(
    (b) => b.outstanding > 0 || b.components.length > 0
  )
  if (q) {
    list = list.filter(
      (b) => b.recipient.toLowerCase().includes(q) || b.department.toLowerCase().includes(q)
    )
  }
  list.forEach((b) => b.components.sort((a, c) => a.position - c.position))
  list.sort((a, b) => b.outstanding - a.outstanding || a.recipient.localeCompare(b.recipient))
  const lim = Math.max(1, Math.min(50, limit || 10))
  const pg = Math.max(1, pageNum || 1)
  return {
    balances: list.slice((pg - 1) * lim, pg * lim),
    total: list.length,
    page: pg,
    limit: lim,
  }
}

function kitHandler(fn, label, { saveRecipient = false } = {}) {
  return async (req, res) => {
    try {
      const result = await withTransaction(async (client) => {
        const b = req.body || {}
        if (!isUuid(b.itemId)) throw new HttpError(404, 'Item not found')
        // the kit and any event it is booked against must belong to this request's site
        await assertItemsInSite(client, req.siteId, [b.itemId], (m) => new HttpError(404, m))
        if (b.eventId) {
          if (!isUuid(b.eventId)) throw new HttpError(400, 'Invalid event')
          await assertEventInSite(client, req.siteId, b.eventId, (m) => new HttpError(400, m))
        }
        let recipient = clean(b.recipient)
        let department = clean(b.department)
        if (saveRecipient && recipient) {
          // add a new recipient to the pick-list / re-use the saved spelling (before any item row is locked)
          const r = await ensureRecipient(client, recipient, department)
          recipient = r.name
          department = r.department
        }
        // Kits are counted in complete sets / single pieces, never in packs or cartons, so a
        // unit is not recorded (it would not be converted and would mislabel the quantity).
        return fn(client, {
          ...b,
          unitId: undefined,
          recipient,
          department,
          performedBy: req.user?.name || 'Unknown',
        })
      })
      res.status(201).json(result)
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e)
      res.status(e.status || 500).json({ error: e instanceof HttpError ? e.message : label })
    }
  }
}

/**
 * Kit operations.
 *  POST /kit-issue   { itemId, mode: 'whole' | 'pieces', sets | lines:[{componentId,quantity}],
 *                      recipient, department, source, eventId, notes, unitId? }
 *  POST /kit-return  { itemId, sets?, lines?:[{componentId,quantity}], recipient, department, notes }
 *  POST /kit-receive { itemId, lines:[{componentId,quantity}], source, vendor, notes }  (loose pieces)
 */
router.post('/kit-issue', kitHandler((client, p) => {
  if (p.mode === 'pieces') return issuePieces(client, p)
  if (p.mode === 'whole') return issueWholeKit(client, p)
  throw new HttpError(400, "mode must be 'whole' or 'pieces'")
}, 'Failed to issue kit', { saveRecipient: true }))
router.post('/kit-return', kitHandler(returnKit, 'Failed to return kit'))
router.post('/kit-receive', kitHandler(receivePieces, 'Failed to receive pieces'))

/**
 * Book back everything one person has out for the listed items, all-or-nothing.
 *  POST /return-batch  { recipient, department, itemIds: [uuid], notes }
 * Consumables are refused (they are returned one at a time with an exact quantity).
 */
router.post('/return-batch', async (req, res) => {
  try {
    const b = req.body || {}
    if (!Array.isArray(b.itemIds) || !b.itemIds.every(isUuid)) {
      return res.status(400).json({ error: 'itemIds must be a list of valid item ids' })
    }
    const result = await withTransaction(async (client) => {
      await assertItemsInSite(client, req.siteId, b.itemIds, (m) => new HttpError(404, m))
      return returnEverything(client, {
        itemIds: b.itemIds,
        recipient: clean(b.recipient),
        department: clean(b.department),
        notes: clean(b.notes),
        performedBy: req.user?.name || 'Unknown',
      })
    })
    res.status(201).json(result)
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e)
    res.status(e.status || 500).json({ error: e instanceof HttpError ? e.message : 'Failed to return items' })
  }
})

/**
 * Bulk issue / bulk receive – many items in ONE all-or-nothing request.
 *  POST /bulk-issue   { requestId, recipient, department, source: 'site'|'event', eventId, notes,
 *                       lines: [{ itemId, unitId?, unitQuantity }] }
 *  POST /bulk-receive { requestId, source: 'vendor'|'head_office', vendor, notes,
 *                       lines: [{ itemId, unitId?, unitQuantity }] }
 * Any bad line rejects the whole batch with 422 { error, lineErrors: [{ index, itemId, message }] }.
 * `requestId` (random, made by the browser) makes a retry or double-click safe: see idempotency.js.
 */
function bulkHandler(fn, label) {
  return async (req, res) => {
    try {
      const b = req.body || {}
      const { result, replayed } = await runOnce(
        req.user?.id || req.user?.username || req.user?.name || 'user',
        b.requestId,
        JSON.stringify([req.siteId, b.lines, b.recipient, b.department, b.source, b.eventId, b.vendor, b.notes]),
        () => withTransaction((client) => fn(client, { ...b, siteId: req.siteId, performedBy: req.user?.name || 'Unknown' }))
      )
      res.status(replayed ? 200 : 201).json({ ...result, replayed })
    } catch (e) {
      if (!(e instanceof HttpError) && !e.status) console.error(e)
      const known = e instanceof HttpError || e.status
      res.status(e.status || 500).json({ error: known ? e.message : label, ...(e.extra || {}) })
    }
  }
}
router.post('/bulk-issue', bulkHandler(bulkIssue, 'Failed to issue stock'))
router.post('/bulk-receive', bulkHandler(bulkReceive, 'Failed to receive stock'))

router.post('/', async (req, res) => {
  try {
    const {
      itemId, type, quantity, unitId, unitQuantity,
      source, eventId, vendor, notes,
    } = req.body
    let recipient = clean(req.body.recipient)
    let department = clean(req.body.department)

    if (!['receive', 'issue', 'return'].includes(type)) {
      return res.status(400).json({ error: 'Invalid transaction type' })
    }
    // Reject zero, negative, non-numeric quantities (they would silently corrupt stock)
    if (!isUuid(itemId)) return res.status(400).json({ error: 'A valid itemId is required' })
    if (unitId && !isUuid(unitId)) return res.status(400).json({ error: 'Invalid unit' })
    if (eventId && !isUuid(eventId)) return res.status(400).json({ error: 'Invalid event' })
    if (type === 'issue' && !recipient) return res.status(400).json({ error: 'Recipient is required' })
    if (type === 'issue' && source === 'event' && !eventId) return res.status(400).json({ error: 'Select the event' })
    if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Quantity must be a number greater than 0' })
    }
    const uQty = unitQuantity === undefined || unitQuantity === null || unitQuantity === ''
      ? Number(quantity)
      : Number(unitQuantity)
    if (!Number.isFinite(uQty) || uQty <= 0) {
      return res.status(400).json({ error: 'Unit quantity must be a number greater than 0' })
    }

    const result = await withTransaction(async (client) => {
      if (type === 'issue') {
        // add a new recipient to the pick-list / re-use the saved spelling (before any item row is locked)
        const r = await ensureRecipient(client, recipient, department)
        recipient = r.name
        department = r.department
      }
      const itemRes = await client.query(
        `SELECT i.id, i.quantity, i.item_type, bu.abbreviation AS base_abbr
         FROM items i LEFT JOIN units bu ON bu.id = i.base_unit_id
         WHERE i.id = $1 AND i.site_id = $2 FOR UPDATE OF i`,
        [itemId, req.siteId]
      )
      if (!itemRes.rows.length) {
        const err = new Error('Item not found')
        err.status = 404
        throw err
      }
      const item = itemRes.rows[0]
      if (eventId) await assertEventInSite(client, req.siteId, eventId, (m) => new HttpError(400, m))

      // The unit must be one that applies to this item. The server works out the base
      // quantity itself from the item's conversion factor, so a wrong or stale browser
      // can never put the wrong number into stock.
      const factor = await resolveUnitFactor(client, itemId, unitId)
      const hasUnitQty = !(unitQuantity === undefined || unitQuantity === null || unitQuantity === '')
      // With a unit and a unit quantity the server converts. With a unit but only a base
      // `quantity`, keep the base quantity and work the unit quantity out from it, so the
      // ledger never says "5 cartons" for what was really 5 pieces.
      // Base quantities keep 10 decimals (1 piece = 1/48 pack = 0.0208333333); 4 would turn 48 pieces into 0.9984 pack.
      const qty = unitId && hasUnitQty ? roundQty(uQty * factor) : roundQty(Number(quantity))
      const unitQty = unitId && !hasUnitQty ? Math.round((qty / factor) * 10000) / 10000 : uQty
      if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error('Quantity must be a number greater than 0')
        err.status = 400
        throw err
      }

      // Kits that list their contents must be issued/returned through the kit endpoints
      // so that every piece is traced. (Receiving whole sets is fine here.)
      if (item.item_type === 'kit' && type !== 'receive' && (await activeComponentCount(client, itemId)) > 0) {
        const err = new Error('This kit lists its contents – issue or return it as a whole kit or by piece')
        err.status = 400
        throw err
      }

      if (type === 'issue' && qty > Number(item.quantity) + QTY_EPSILON) {
        const err = new Error(`Insufficient stock. Available: ${Math.round(Number(item.quantity) * 10000) / 10000}${item.base_abbr ? ` ${item.base_abbr}` : ''}`)
        err.status = 400
        throw err
      }

      if (type === 'return') {
        // Consumables may come back too (wrong item issued, unopened pack, ...). The cap below
        // is what that person was issued minus what they already returned.
        if (!recipient) {
          const err = new Error('Recipient is required for returns')
          err.status = 400
          throw err
        }
        // Cap return at outstanding for this recipient
        const outstanding = await returnableBalance(client, itemId, recipient, department)
        if (qty > outstanding + QTY_EPSILON) {
          const err = new Error(
            `Cannot return more than outstanding (${Math.round(outstanding * 10000) / 10000}) for ${recipient}`
          )
          err.status = 400
          throw err
        }

        // Always attribute the return to the original issue context(s) via FIFO so
        // event history and the SOURCE column stay accurate. Client-supplied
        // source/eventId are ignored for returns – forcing "site" (or the wrong
        // event) was causing returns to disappear from event logs and show the
        // wrong SOURCE on item history.
        const slices = await resolveReturnAttribution(client, itemId, recipient, department, qty)

        await applyStockDelta(client, itemId, qty, { clampAtZero: true })

        // Scale unit_quantity proportionally across slices when the client sent one.
        const totalBase = qty
        let firstRow = null
        for (const slice of slices) {
          const sliceUnitQty = totalBase > QTY_EPSILON
            ? Math.round((unitQty * (slice.quantity / totalBase)) * 10000) / 10000
            : unitQty
          const txnRes = await client.query(
            `INSERT INTO transactions
             (item_id, type, quantity, unit_id, unit_quantity, source, event_id, vendor, recipient, department, notes, performed_by)
             VALUES ($1,'return',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              itemId, slice.quantity, unitId || null, sliceUnitQty,
              slice.source, slice.eventId, vendor || null,
              recipient || null, department || null, notes || null,
              req.user?.name || 'Unknown',
            ]
          )
          if (!firstRow) firstRow = txnRes.rows[0]
        }
        return firstRow
      }

      let delta = 0
      if (type === 'receive') delta = qty
      else if (type === 'issue') delta = -qty

      await applyStockDelta(client, itemId, delta, { clampAtZero: true })

      const txnRes = await client.query(
        `INSERT INTO transactions
         (item_id, type, quantity, unit_id, unit_quantity, source, event_id, vendor, recipient, department, notes, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          itemId, type, qty, unitId || null, unitQty,
          source || null, eventId || null, vendor || null,
          recipient || null, department || null, notes || null,
          req.user?.name || 'Unknown',
        ]
      )
      return txnRes.rows[0]
    })

    res.status(201).json(mapTxn(result))
  } catch (e) {
    // Only messages written for the user are sent back; a database/driver error text stays in the log
    const known = e instanceof HttpError || (Number.isInteger(e.status) && e.status < 500)
    if (!known) console.error(e)
    res.status(known ? e.status : 500).json({ error: known ? e.message : 'Failed to create transaction' })
  }
})

// Deleting a ledger line must also undo its effect on stock, otherwise the
// inventory no longer matches the history. Admin only; kit lines must be
// corrected with a new transaction instead.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [req.params.id])
      if (!rows.length) throw new HttpError(404, 'Not found')
      const t = rows[0]
      const itemRes = await client.query('SELECT id, quantity, item_type, site_id FROM items WHERE id=$1 FOR UPDATE', [t.item_id])
      const item = itemRes.rows[0]
      // a ledger line belongs to its item's site; one from another site does not exist as far as this request is concerned
      if (!item || item.site_id !== req.siteId) throw new HttpError(404, 'Not found')
      if (item?.item_type === 'kit' || t.component_id || t.parent_txn_id) {
        throw new HttpError(400, 'Kit transactions cannot be deleted – record a correcting transaction instead')
      }
      // Removing an issue that was already (partly) returned would leave those returns with nothing
      // they were returned FROM: the person's balance goes negative (hidden by the "never below 0"
      // rules) and stock gets the quantity back twice. The returns have to be deleted first.
      if (t.type === 'issue' && t.recipient) {
        const balance = await returnableBalance(client, t.item_id, t.recipient, t.department)
        if (balance - Number(t.quantity) < -QTY_EPSILON) {
          throw new HttpError(
            409,
            `${t.recipient} has already returned some of this issue. Delete the matching return entries first, then this one.`
          )
        }
      }
      if (item) {
        const delta = t.type === 'issue' ? Number(t.quantity) : -Number(t.quantity)
        if (Number(item.quantity) + delta < -QTY_EPSILON) {
          throw new HttpError(409, 'Deleting this entry would make the stock negative')
        }
        await applyStockDelta(client, t.item_id, delta, { clampAtZero: true })
      }
      await client.query('DELETE FROM transactions WHERE id=$1', [t.id])
    })
    res.status(204).end()
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
    console.error(e)
    res.status(500).json({ error: 'Failed to delete transaction' })
  }
})

export default router
