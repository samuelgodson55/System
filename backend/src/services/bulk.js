/**
 * Bulk issue / bulk receive.
 *
 * One request books many items at once, ALL-OR-NOTHING: every line is checked first and, if any
 * line is wrong, nothing is written and the response lists every problem so they can all be fixed
 * in one go. Each line becomes an ordinary ledger line (type 'issue' / 'receive'), exactly like the
 * single-item forms write, so balances, returns, history, exports and reports need no changes
 * and there is no database change.
 *
 * Rules that keep it safe next to the single-item flow:
 *  - same lock order as everywhere else: the recipient pick-list (advisory lock) FIRST, then the
 *    item rows in a fixed (id) order, so concurrent requests can never deadlock;
 *  - the server converts units itself (resolveUnitFactor) – the browser's numbers are never trusted;
 *  - stock is re-checked against the locked rows, cumulatively if an item is listed twice;
 *  - kits that list their contents cannot be issued here (their pieces must be traced through the
 *    kit endpoints); receiving whole sets of them is allowed, as in the single form.
 *
 * Every function expects to run inside withTransaction().
 */
import { HttpError, activeComponentCount } from './kits.js'
import { resolveUnitFactor, applyStockDelta, stockGrid, snapToGrid, roundQty, QTY_EPSILON } from './itemUnits.js'
import { ensureRecipient } from './recipients.js'
import { isUuid, clean } from '../middleware/validate.js'

export const MAX_BULK_LINES = 200
// items.quantity is NUMERIC(22,10): keep a single line well inside it
const MAX_LINE_QTY = 1e9

const round4 = (n) => Math.round(n * 10000) / 10000 // what a person typed / is shown

/** A 422 that carries every line problem: { error, lineErrors: [{ index, itemId, message }] }. */
export class BulkValidationError extends HttpError {
  constructor(lineErrors) {
    super(
      422,
      lineErrors.length === 1
        ? 'One line needs attention – nothing was saved'
        : `${lineErrors.length} lines need attention – nothing was saved`
    )
    this.extra = { lineErrors }
  }
}

function checkLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'Add at least one item')
  if (lines.length > MAX_BULK_LINES) {
    throw new HttpError(400, `Too many lines in one batch (max ${MAX_BULK_LINES}) – split it into smaller batches`)
  }
  return lines.map((l, index) => {
    const raw = l || {}
    const out = { index, itemId: raw.itemId, unitId: raw.unitId || null, error: null, qty: 0, unitQty: 0 }
    const q = raw.unitQuantity === undefined || raw.unitQuantity === null || raw.unitQuantity === ''
      ? NaN
      : Number(raw.unitQuantity)
    if (!isUuid(raw.itemId)) out.error = 'Item not found'
    else if (raw.unitId && !isUuid(raw.unitId)) out.error = 'Invalid unit'
    else if (!Number.isFinite(q) || q <= 0) out.error = 'Quantity must be a number greater than 0'
    else if (q > MAX_LINE_QTY) out.error = 'Quantity is too large'
    else out.unitQty = round4(q)
    if (!out.error && out.unitQty <= 0) out.error = 'Quantity is too small'
    return out
  })
}

async function lockItems(client, ids) {
  const sorted = [...new Set(ids)].sort() // fixed order → no deadlocks between requests
  if (!sorted.length) return new Map()
  const { rows } = await client.query(
    `SELECT i.id, i.name, i.sku, i.quantity, i.item_type, bu.abbreviation AS base_abbr
     FROM items i LEFT JOIN units bu ON bu.id = i.base_unit_id
     WHERE i.id = ANY($1::uuid[])
     ORDER BY i.id
     FOR UPDATE OF i`,
    [sorted]
  )
  return new Map(rows.map((r) => [r.id, { ...r, stock: Number(r.quantity) }]))
}

/**
 * Shared engine. `p` = { type: 'issue'|'receive', lines, recipient, department, source,
 * eventId, vendor, notes, performedBy }. Returns { type, count, lines }.
 */
async function bulkRun(client, p) {
  const { type } = p
  const parsed = checkLines(p.lines)

  const notes = clean(p.notes)
  let recipient
  let department
  let source
  let eventId = null
  let vendor = null

  if (type === 'issue') {
    recipient = clean(p.recipient)
    department = clean(p.department)
    source = p.source === 'event' ? 'event' : 'site'
    if (!recipient) throw new HttpError(400, 'Recipient is required')
    if (source === 'event') {
      if (!isUuid(p.eventId)) throw new HttpError(400, 'Select the event')
      eventId = p.eventId
    }
    // add a new recipient to the pick-list / re-use the saved spelling (before any item row is locked)
    const r = await ensureRecipient(client, recipient, department)
    recipient = r.name
    department = r.department
    if (eventId) {
      const ev = await client.query('SELECT 1 FROM events WHERE id = $1', [eventId])
      if (!ev.rows.length) throw new HttpError(400, 'That event no longer exists')
    }
  } else {
    source = p.source === 'head_office' ? 'head_office' : 'vendor'
    vendor = source === 'vendor' ? clean(p.vendor) || null : null
    if (vendor && vendor.length > 200) throw new HttpError(400, 'Vendor name must be 200 characters or fewer')
  }

  const items = await lockItems(client, parsed.filter((l) => !l.error).map((l) => l.itemId))
  const kitCache = new Map()

  // 1) check every line against the locked rows
  for (const l of parsed) {
    if (l.error) continue
    const item = items.get(l.itemId)
    if (!item) {
      l.error = 'Item not found (it may have been deleted)'
      continue
    }
    l.item = item
    try {
      if (type === 'issue' && item.item_type === 'kit') {
        if (!kitCache.has(item.id)) kitCache.set(item.id, await activeComponentCount(client, item.id))
        if (kitCache.get(item.id) > 0) {
          throw new HttpError(400, 'This kit lists its contents – issue it as a whole kit or by piece on the single Issue tab')
        }
      }
      const factor = await resolveUnitFactor(client, l.itemId, l.unitId)
      l.qty = roundQty(l.unitQty * factor) // base quantity keeps 10 decimals (1 piece = 1/48 pack)
      if (!Number.isFinite(l.qty) || l.qty <= 0) throw new HttpError(400, 'Quantity is too small for that unit')
      if (l.qty > MAX_LINE_QTY) throw new HttpError(400, 'Quantity is too large')
      if (type === 'issue') {
        // running balance: the same item listed twice cannot be issued beyond what is in store
        if (l.qty > item.stock + QTY_EPSILON) {
          throw new HttpError(
            400,
            `Insufficient stock. Available: ${round4(item.stock)}${item.base_abbr ? ` ${item.base_abbr}` : ''}`
          )
        }
        item.grid ??= await stockGrid(client, item.id)
        item.stock = Math.max(0, snapToGrid(item.stock - l.qty, item.grid))
      } else {
        item.grid ??= await stockGrid(client, item.id)
        item.stock = snapToGrid(item.stock + l.qty, item.grid)
        if (item.stock > MAX_LINE_QTY * 10) throw new HttpError(400, 'Resulting stock is too large')
      }
    } catch (e) {
      if (!(e instanceof HttpError)) throw e
      l.error = e.message
    }
  }

  const problems = parsed
    .filter((l) => l.error)
    .map((l) => ({ index: l.index, itemId: isUuid(l.itemId) ? l.itemId : null, message: l.error }))
  if (problems.length) throw new BulkValidationError(problems)

  // 2) write: one stock update per item, one ledger line per entered line
  const sign = type === 'issue' ? -1 : 1
  const delta = new Map()
  for (const l of parsed) delta.set(l.itemId, roundQty((delta.get(l.itemId) || 0) + sign * l.qty))
  for (const id of [...delta.keys()].sort()) {
    await applyStockDelta(client, id, delta.get(id), { clampAtZero: true })
  }

  const out = []
  for (const l of parsed) {
    const { rows } = await client.query(
      `INSERT INTO transactions
       (item_id, type, quantity, unit_id, unit_quantity, source, event_id, vendor, recipient, department, notes, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        l.itemId, type, l.qty, l.unitId, l.unitQty, source, eventId, vendor,
        recipient || null, department || null, notes || null, p.performedBy || 'Unknown',
      ]
    )
    out.push({
      transactionId: rows[0].id,
      itemId: l.itemId,
      itemName: l.item.name,
      sku: l.item.sku,
      quantity: l.qty,
      unitId: l.unitId,
      unitQuantity: l.unitQty,
      baseAbbr: l.item.base_abbr || null,
    })
  }
  // final stock per item (after every line), so the screen can show the new balance
  for (const row of out) row.newStock = items.get(row.itemId).stock

  return { type, count: out.length, recipient: recipient || null, department: department || null, lines: out }
}

export const bulkIssue = (client, p) => bulkRun(client, { ...p, type: 'issue' })
export const bulkReceive = (client, p) => bulkRun(client, { ...p, type: 'receive' })
