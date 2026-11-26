/**
 * Data exports.
 *
 * Every dataset is described once (title, columns, how to read the rows) and can then be
 * delivered as CSV (a download), or as JSON rows (used by the browser to build PDF reports).
 *
 *  - Read-only: nothing here writes to the database, so it needs no migration.
 *  - Large tables (the transaction ledger) are read in keyset-paginated batches and streamed,
 *    so memory stays flat however long the history grows.
 *  - Times are rendered in the caller's time zone (`tz`), the same way Daily Issues does it.
 */
import { query } from '../db/pool.js'
import { isUuid } from '../middleware/validate.js'
import { listOutstanding } from './outstanding.js'

export class ExportError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const bad = (m) => new ExportError(400, m)

const BATCH = 1000
// 8 decimals: drops rounding dust from fractional units (0.9999999984 -> 1) without hiding real values
const num = (v) => (v == null ? '' : Math.round(Number(v) * 1e8) / 1e8)
const text = (v) => (v == null ? '' : String(v))
const yn = (v) => (v ? 'Yes' : 'No')

/** A timestamp as "YYYY-MM-DD HH:mm" in the caller's time zone. */
const stamp = (v, tz) => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d)
}

// ---------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------

const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const ITEM_TYPES = ['consumable', 'reusable', 'kit']
const TXN_TYPES = ['receive', 'issue', 'return']
const EVENT_STATUSES = ['upcoming', 'active', 'completed']
const OUT_TYPES = ['expected', 'consumable', 'all']

const str = (v, max = 200) => {
  const s = Array.isArray(v) ? v[0] : v
  return s == null ? '' : String(s).trim().slice(0, max)
}

/** Validate and normalise the query string. Throws a 400 for anything malformed. */
export async function parseParams(q = {}) {
  const p = {
    from: str(q.from, 10),
    to: str(q.to, 10),
    tz: str(q.tz, 64) || 'UTC',
    search: str(q.search),
    category: str(q.category, 100),
    itemType: str(q.itemType, 20),
    type: str(q.type, 20),
    status: str(q.status, 20),
    itemId: str(q.itemId, 36),
    eventId: str(q.eventId, 36),
    outType: str(q.outType, 20) || 'expected',
    days: Math.min(365, Math.max(1, Math.trunc(Number(q.days)) || 30)),
    lowStock: ['1', 'true'].includes(str(q.lowStock, 5)),
    topLevel: ['1', 'true'].includes(str(q.topLevel, 5)),
    faultStatus: str(q.faultStatus, 20) || 'all',
    department: str(q.department, 120),
    usability: str(q.usability, 20),
  }
  for (const k of ['from', 'to']) {
    if (p[k] && !isRealDate(p[k])) throw bad(`"${k}" must be a valid date (YYYY-MM-DD)`)
  }
  if (p.from && p.to && p.from > p.to) throw bad('"from" must be on or before "to"')
  if (p.itemType && !ITEM_TYPES.includes(p.itemType)) throw bad('Unknown item type')
  if (p.type && !TXN_TYPES.includes(p.type)) throw bad('Unknown transaction type')
  if (p.status && !EVENT_STATUSES.includes(p.status)) throw bad('Unknown event status')
  if (!['all', 'open', 'resolved'].includes(p.faultStatus)) throw bad('Unknown fault status')
  if (p.usability && !['usable', 'unusable'].includes(p.usability)) throw bad('Unknown usability')
  if (!OUT_TYPES.includes(p.outType)) throw bad('Unknown outstanding type')
  if (p.itemId && !isUuid(p.itemId)) throw bad('Invalid item id')
  if (p.eventId && !isUuid(p.eventId)) throw bad('Invalid event id')
  if (p.tz !== 'UTC') {
    const r = await query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [p.tz])
    if (!r.rows.length) throw bad('Unknown time zone')
    // PostgreSQL knows a few zone names that Node's Intl does not; catch that here, as a clean 400,
    // instead of crashing half-way through a streamed download when the first date is formatted.
    try {
      new Intl.DateTimeFormat('sv-SE', { timeZone: p.tz })
    } catch {
      throw bad('Unknown time zone')
    }
  }
  return p
}

// ---------------------------------------------------------------------------------------
// Shared SQL
// ---------------------------------------------------------------------------------------

/** Quantity currently out and expected back (same rule as the Inventory page). */
const OUTSTANDING_SQL = `
  CASE WHEN i.item_type = 'consumable' THEN 0 ELSE COALESCE((
    SELECT SUM(GREATEST(0, bal)) FROM (
      SELECT SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
           - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) AS bal
      FROM transactions t
      WHERE t.item_id = i.id AND t.recipient IS NOT NULL AND t.recipient <> ''
        AND t.component_id IS NULL
      GROUP BY t.recipient, COALESCE(t.department, '')
    ) per_recipient
  ), 0) END`

function itemFilters(p, args) {
  // every item report is limited to ONE site (the route puts the request's site on p.siteId)
  if (!p.siteId) throw new Error('export needs a siteId')
  args.push(p.siteId)
  const where = [`i.site_id = $${args.length}`]
  if (p.search) {
    args.push(`%${p.search}%`)
    const n = args.length
    where.push(`(i.name ILIKE $${n} OR i.sku ILIKE $${n} OR i.category ILIKE $${n} OR i.location ILIKE $${n}
      OR EXISTS (SELECT 1 FROM kit_components kc WHERE kc.kit_id = i.id AND kc.is_active AND kc.name ILIKE $${n}))`)
  }
  if (p.category) {
    args.push(p.category)
    where.push(`lower(btrim(i.category)) = lower($${args.length})`)
  }
  if (p.itemType) {
    args.push(p.itemType)
    where.push(`i.item_type = $${args.length}`)
  }
  if (p.lowStock) where.push('i.quantity <= i.reorder_level')
  return `WHERE ${where.join(' AND ')}`
}

const col = (key, label) => ({ key, label })

// ---------------------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------------------

async function* inventoryRows(p) {
  const args = []
  const where = itemFilters(p, args)
  const { rows } = await query(
    `SELECT i.*, bu.abbreviation AS unit, ${OUTSTANDING_SQL} AS outstanding,
            COALESCE((SELECT SUM(kc.loose_quantity) FROM kit_components kc
                      WHERE kc.kit_id = i.id AND kc.is_active), 0) AS loose
     FROM items i LEFT JOIN units bu ON bu.id = i.base_unit_id
     ${where} ORDER BY i.name, i.id`,
    args
  )
  yield rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    category: text(r.category),
    type: r.item_type,
    available: num(r.quantity),
    outstanding: num(r.outstanding),
    total: Number(r.quantity) + Number(r.outstanding),
    unit: r.item_type === 'kit' ? 'sets' : text(r.unit),
    reorder: num(r.reorder_level),
    status: Number(r.quantity) <= Number(r.reorder_level) ? 'Low' : 'OK',
    location: text(r.location),
    loose: r.item_type === 'kit' ? num(r.loose) : '',
    description: text(r.description),
    created: stamp(r.created_at, p.tz),
    updated: stamp(r.updated_at, p.tz),
  }))
}

async function* lowStockRows(p) {
  yield* inventoryRows({ ...p, lowStock: true })
}

async function* kitRows(p) {
  const args = []
  const where = itemFilters({ ...p, itemType: 'kit' }, args)
  const { rows } = await query(
    `SELECT i.sku, i.name AS kit, i.quantity AS sets, kc.name AS piece, kc.quantity_per_kit,
            kc.loose_quantity, kc.notes,
            COALESCE((
              SELECT SUM(GREATEST(0, bal)) FROM (
                SELECT SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
                     - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) AS bal
                FROM transactions t
                WHERE t.component_id = kc.id AND t.recipient IS NOT NULL AND t.recipient <> ''
                GROUP BY t.recipient, COALESCE(t.department, '')
              ) per_recipient
            ), 0) AS out
     FROM items i JOIN kit_components kc ON kc.kit_id = i.id AND kc.is_active
     ${where} ORDER BY i.name, i.id, kc.position, kc.name`,
    args
  )
  yield rows.map((r) => ({
    sku: r.sku,
    kit: r.kit,
    piece: r.piece,
    perSet: r.quantity_per_kit,
    loose: r.loose_quantity,
    inStore: Number(r.sets) * r.quantity_per_kit + r.loose_quantity,
    out: num(r.out),
    notes: text(r.notes),
  }))
}

async function* outstandingRows(p) {
  const out = []
  for (let page = 1; ; page++) {
    const res = await listOutstanding({
      search: p.search, type: p.outType, days: p.days, department: p.department, groupBy: 'recipient', page, limit: 50,
      siteId: p.siteId,
    })
    for (const g of res.groups) {
      for (const l of g.lines) {
        const pieces = l.components.reduce((n, c) => n + c.outstanding, 0)
        out.push({
          recipient: l.recipient,
          department: text(l.department),
          sku: l.sku,
          item: l.itemName,
          type: l.itemType,
          outstanding: l.outstanding,
          unit: l.unit,
          pieces: l.itemType === 'kit' ? pieces : '',
          pieceList: l.components.map((c) => `${c.outstanding} x ${c.name}`).join('; '),
          lastIssued: stamp(l.lastIssuedAt, p.tz),
        })
      }
    }
    if (page * res.limit >= res.total) break
  }
  yield out
}

async function* eventRows(p) {
  const args = [p.siteId]
  const where = ['e.site_id = $1']
  if (p.status) { args.push(p.status); where.push(`e.status = $${args.length}`) }
  if (p.from) { args.push(p.from); where.push(`e.start_date >= $${args.length}::date`) }
  if (p.to) { args.push(p.to); where.push(`e.start_date <= $${args.length}::date`) }
  const { rows } = await query(
    `SELECT e.*, to_char(e.start_date, 'YYYY-MM-DD') AS start_txt, to_char(e.end_date, 'YYYY-MM-DD') AS end_txt,
            (SELECT COUNT(*) FROM transactions t WHERE t.event_id = e.id AND t.parent_txn_id IS NULL) AS txns
     FROM events e WHERE ${where.join(' AND ')}
     ORDER BY e.start_date DESC NULLS LAST, e.name`,
    args
  )
  yield rows.map((r) => ({
    name: r.name,
    status: r.status,
    location: text(r.location),
    start: text(r.start_txt),
    end: text(r.end_txt),
    description: text(r.description),
    txns: num(r.txns),
  }))
}

async function* eventUsageRows(p) {
  const args = [p.siteId]
  const where = ['t.event_id IS NOT NULL', 't.parent_txn_id IS NULL', 'i.site_id = $1']
  if (p.eventId) { args.push(p.eventId); where.push(`t.event_id = $${args.length}`) }
  if (p.from || p.to) args.push(p.tz)
  const tzRef = `$${args.length}`
  if (p.from) { args.push(p.from); where.push(`t.created_at >= ($${args.length}::date)::timestamp AT TIME ZONE ${tzRef}`) }
  if (p.to) { args.push(p.to); where.push(`t.created_at < ($${args.length}::date + 1)::timestamp AT TIME ZONE ${tzRef}`) }
  const { rows } = await query(
    `SELECT e.name AS event, to_char(e.start_date, 'YYYY-MM-DD') AS start_txt, i.sku, i.name AS item, i.item_type, bu.abbreviation AS unit,
            SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END) AS issued,
            SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) AS returned,
            SUM(CASE WHEN t.type = 'receive' THEN t.quantity ELSE 0 END) AS received
     FROM transactions t
     JOIN events e ON e.id = t.event_id
     JOIN items i ON i.id = t.item_id
     LEFT JOIN units bu ON bu.id = i.base_unit_id
     WHERE ${where.join(' AND ')}
     GROUP BY e.id, e.name, e.start_date, i.id, i.sku, i.name, i.item_type, bu.abbreviation
     ORDER BY e.start_date DESC NULLS LAST, e.name, i.name`,
    args
  )
  yield rows.map((r) => ({
    event: r.event,
    start: text(r.start_txt),
    sku: r.sku,
    item: r.item,
    issued: num(r.issued),
    returned: num(r.returned),
    net: Number(r.issued) - Number(r.returned),
    received: num(r.received),
    unit: r.item_type === 'kit' ? 'sets' : text(r.unit),
  }))
}

async function* unitRows(p) {
  const { rows } = await query(
    `SELECT u.*, (SELECT COUNT(*) FROM item_units iu JOIN items i ON i.id = iu.item_id
                   WHERE iu.unit_id = u.id AND i.site_id = $1) AS items
     FROM units u ORDER BY u.is_base DESC, u.name`,
    [p.siteId]
  )
  yield rows.map((r) => ({
    name: r.name,
    abbr: r.abbreviation,
    factor: num(r.conversion_factor),
    base: yn(r.is_base),
    items: num(r.items),
  }))
}

async function* userRows(p) {
  const { rows } = await query(
    `SELECT u.name, u.username, u.role, u.created_at, s.name AS site
     FROM users u LEFT JOIN sites s ON s.id = u.site_id ORDER BY u.name`
  )
  yield rows.map((r) => ({
    name: r.name, username: r.username, role: r.role,
    site: r.role === 'admin' ? 'All sites' : text(r.site),
    created: stamp(r.created_at, p.tz),
  }))
}

const LEDGER_SELECT = `
  SELECT t.id, t.type, t.quantity, t.unit_quantity, t.source, t.vendor, t.recipient, t.department,
         t.notes, t.performed_by, t.component_id, t.parent_txn_id, t.created_at::text AS created_raw,
         to_char(t.created_at AT TIME ZONE $1, 'YYYY-MM-DD') AS d,
         to_char(t.created_at AT TIME ZONE $1, 'HH24:MI:SS') AS tm,
         i.sku, i.name AS item, i.item_type, u.abbreviation AS unit, bu.abbreviation AS base_unit,
         kc.name AS piece, e.name AS event
  FROM transactions t
  JOIN items i ON i.id = t.item_id
  LEFT JOIN kit_components kc ON kc.id = t.component_id
  LEFT JOIN units u ON u.id = t.unit_id
  LEFT JOIN units bu ON bu.id = i.base_unit_id
  LEFT JOIN events e ON e.id = t.event_id`

/** WHERE parts shared by the ledger rows and the ledger overview ($1 is always the time zone). */
function ledgerFilter(p) {
  const args = [p.tz]
  const where = []
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)) }
  // a ledger line belongs to the site of its item
  add('t.item_id IN (SELECT id FROM items WHERE site_id = ?)', p.siteId)
  if (p.type) add('t.type = ?', p.type)
  if (p.itemId) add('t.item_id = ?', p.itemId)
  if (p.eventId) add('t.event_id = ?', p.eventId)
  if (p.from) add(`t.created_at >= (?::date)::timestamp AT TIME ZONE $1`, p.from)
  if (p.to) add(`t.created_at < (?::date + 1)::timestamp AT TIME ZONE $1`, p.to)
  if (p.topLevel) where.push('t.parent_txn_id IS NULL')
  return { args, where }
}

/** The whole movement ledger, newest first, read in keyset-paginated batches. */
async function* ledgerRows(p) {
  const { args, where } = ledgerFilter(p)

  let cursor = null
  for (;;) {
    const a = [...args]
    const w = [...where]
    if (cursor) {
      a.push(cursor.created, cursor.id)
      w.push(`(t.created_at, t.id) < ($${a.length - 1}::timestamptz, $${a.length}::uuid)`)
    }
    a.push(BATCH)
    const { rows } = await query(
      `${LEDGER_SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
       ORDER BY t.created_at DESC, t.id DESC LIMIT $${a.length}`,
      a
    )
    if (!rows.length) return
    yield rows.map((r) => {
      const kit = r.item_type === 'kit'
      return {
        date: r.d,
        time: r.tm,
        type: r.type,
        sku: r.sku,
        item: r.item,
        line: r.component_id ? 'Kit piece' : kit ? 'Whole kit' : 'Item',
        piece: text(r.piece),
        qty: kit ? num(r.quantity) : num(r.unit_quantity),
        unit: kit ? (r.component_id ? 'pcs' : 'sets') : text(r.unit),
        baseQty: num(r.quantity),
        baseUnit: kit ? (r.component_id ? 'pcs' : 'sets') : text(r.base_unit),
        source: text(r.source),
        event: text(r.event),
        vendor: text(r.vendor),
        recipient: text(r.recipient),
        department: text(r.department),
        by: text(r.performed_by),
        notes: text(r.notes),
        id: r.id,
      }
    })
    if (rows.length < BATCH) return
    const last = rows[rows.length - 1]
    cursor = { created: last.created_raw, id: last.id }
  }
}

/**
 * Stock receipts (type = 'receive') for the "Receipt history" export.
 * Mirrors what the Receive Stock page lists: top-level receipts only (a kit's piece lines are part of
 * their parent), limited to this site, with the same free-text search as that page.
 */
function receiptFilter(p) {
  const { args, where } = ledgerFilter({ ...p, type: 'receive', topLevel: true })
  const term = String(p.search || '').trim().slice(0, 100)
  if (term) {
    args.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`) // % _ \ match literally
    const n = `$${args.length}`
    where.push(
      `(EXISTS (SELECT 1 FROM items si WHERE si.id = t.item_id AND (si.name ILIKE ${n} OR si.sku ILIKE ${n}))
        OR EXISTS (SELECT 1 FROM kit_components sk WHERE sk.id = t.component_id AND sk.name ILIKE ${n})
        OR t.vendor ILIKE ${n} OR t.recipient ILIKE ${n} OR t.notes ILIKE ${n} OR t.performed_by ILIKE ${n})`
    )
  }
  return { args, where }
}

async function* receiptRows(p) {
  const { args, where } = receiptFilter(p)
  let cursor = null
  for (;;) {
    const a = [...args]
    const w = [...where]
    if (cursor) {
      a.push(cursor.created, cursor.id)
      w.push(`(t.created_at, t.id) < ($${a.length - 1}::timestamptz, $${a.length}::uuid)`)
    }
    a.push(BATCH)
    const { rows } = await query(
      `${LEDGER_SELECT} WHERE ${w.join(' AND ')}
       ORDER BY t.created_at DESC, t.id DESC LIMIT $${a.length}`,
      a
    )
    if (!rows.length) return
    yield rows.map((r) => {
      const kit = r.item_type === 'kit'
      return {
        date: r.d,
        time: r.tm,
        sku: r.sku,
        item: r.item,
        line: r.component_id ? 'Kit piece' : kit ? 'Whole kit' : 'Item',
        piece: text(r.piece),
        qty: kit ? num(r.quantity) : num(r.unit_quantity),
        unit: kit ? (r.component_id ? 'pcs' : 'sets') : text(r.unit),
        source: r.source === 'head_office' ? 'Head Office' : 'Vendor',
        vendor: text(r.vendor),
        by: text(r.performed_by),
        notes: text(r.notes),
        id: r.id,
      }
    })
    if (rows.length < BATCH) return
    const last = rows[rows.length - 1]
    cursor = { created: last.created_raw, id: last.id }
  }
}

/** Receipts stream, so (like the ledger) their overview is one aggregate query. */
async function receiptsOverview(p) {
  const { args, where } = receiptFilter(p)
  const { rows } = await query(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT t.item_id) AS items,
            COUNT(*) FILTER (WHERE t.source = 'head_office') AS head_office,
            COUNT(*) FILTER (WHERE t.source IS DISTINCT FROM 'head_office') AS vendors,
            COUNT(DISTINCT NULLIF(btrim(t.vendor), '')) AS vendor_names,
            to_char(MIN(t.created_at) AT TIME ZONE $1, 'YYYY-MM-DD') AS first_day,
            to_char(MAX(t.created_at) AT TIME ZONE $1, 'YYYY-MM-DD') AS last_day
     FROM transactions t WHERE ${where.join(' AND ')}`,
    args
  )
  const r = rows[0] || {}
  return [
    stat('Receipts', Number(r.total || 0)),
    stat('Different items', Number(r.items || 0)),
    stat('From head office', Number(r.head_office || 0)),
    stat('From vendors', Number(r.vendors || 0)),
    stat('Different vendors', Number(r.vendor_names || 0)),
    r.first_day ? stat('First receipt', r.first_day) : null,
    r.last_day ? stat('Latest receipt', r.last_day) : null,
  ].filter(Boolean)
}

async function* faultRows(p) {
  const args = [p.tz]
  const where = []
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)) }
  add('i.site_id = ?', p.siteId)
  if (p.faultStatus !== 'all') add('f.status = ?', p.faultStatus)
  if (p.usability) add('f.usability = ?', p.usability)
  if (p.itemId) add('f.item_id = ?', p.itemId)
  if (p.from) add(`f.reported_at >= (?::date)::timestamp AT TIME ZONE $1`, p.from)
  if (p.to) add(`f.reported_at < (?::date + 1)::timestamp AT TIME ZONE $1`, p.to)
  if (p.search) {
    args.push(`%${p.search}%`)
    const n = args.length
    where.push(`(i.name ILIKE $${n} OR i.sku ILIKE $${n} OR f.description ILIKE $${n} OR kc.name ILIKE $${n}
      OR f.found_with ILIKE $${n} OR f.workaround ILIKE $${n})`)
  }
  const { rows } = await query(
    `SELECT f.*, i.sku, i.name AS item, i.item_type, kc.name AS piece, bu.abbreviation AS base_unit,
            to_char(f.reported_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS rep_txt,
            to_char(f.resolved_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS res_txt,
            GREATEST(0, EXTRACT(DAY FROM (COALESCE(f.resolved_at, NOW()) - f.reported_at)))::int AS days_open
     FROM item_faults f
     JOIN items i ON i.id = f.item_id
     LEFT JOIN kit_components kc ON kc.id = f.component_id
     LEFT JOIN units bu ON bu.id = i.base_unit_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY f.reported_at DESC, f.id`,
    args
  )
  const RES = { repaired: 'Repaired', replaced: 'Replaced', written_off: 'Written off', no_fault: 'No fault found' }
  yield rows.map((r) => ({
    reported: text(r.rep_txt),
    sku: r.sku,
    item: r.item,
    piece: text(r.piece),
    qty: num(r.quantity_affected),
    unit: r.item_type === 'kit' ? (r.component_id ? 'pcs' : 'sets') : text(r.base_unit),
    fault: r.description,
    canIssue: r.usability === 'usable' ? 'Yes - usable with fault' : 'No - out of service',
    workaround: text(r.workaround),
    foundWith: text(r.found_with),
    status: r.status === 'open' ? 'Open' : 'Resolved',
    reportedBy: text(r.reported_by),
    resolution: r.resolution ? RES[r.resolution] || r.resolution : '',
    resolutionNotes: text(r.resolution_notes),
    resolved: text(r.res_txt),
    resolvedBy: text(r.resolved_by),
    daysOpen: num(r.days_open),
  }))
}


// ---------------------------------------------------------------------------------------
// Report overview: the headline figures printed above the table (CSV top block / PDF tiles)
// ---------------------------------------------------------------------------------------

const fmtN = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
const stat = (label, value) => ({ label, value: typeof value === 'number' ? fmtN(value) : text(value) })
const distinct = (list) => new Set(list.map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean)).size
const countBy = (rows, fn) => rows.filter(fn).length

const OVERVIEWS = {
  inventory: (rows) => {
    const kits = rows.filter((r) => r.type === 'kit')
    return [
      stat('Total SKUs in store', rows.length),
      stat('Consumables', countBy(rows, (r) => r.type === 'consumable')),
      stat('Reusable items', countBy(rows, (r) => r.type === 'reusable')),
      stat('Kits', kits.length),
      stat('Categories', distinct(rows.map((r) => r.category))),
      stat('Low stock (at/below reorder)', countBy(rows, (r) => r.status === 'Low')),
      stat('Out of stock', countBy(rows, (r) => Number(r.available) <= 0)),
      stat('Items currently issued out', countBy(rows, (r) => Number(r.outstanding) > 0)),
    ]
  },
  'low-stock': (rows) => [
    stat('Items to reorder', rows.length),
    stat('Out of stock', countBy(rows, (r) => Number(r.available) <= 0)),
    stat('Categories affected', distinct(rows.map((r) => r.category))),
  ],
  'kit-contents': (rows) => [
    stat('Kits', distinct(rows.map((r) => r.sku))),
    stat('Pieces listed', rows.length),
    stat('Pieces in store', rows.reduce((n, r) => n + Number(r.inStore || 0), 0)),
    stat('Pieces currently out', rows.reduce((n, r) => n + Number(r.out || 0), 0)),
  ],
  outstanding: (rows) => {
    const dates = rows.map((r) => r.lastIssued).filter(Boolean).sort()
    return [
      stat('Recipients holding stock', distinct(rows.map((r) => r.recipient))),
      stat('Departments', distinct(rows.map((r) => r.department))),
      stat('Outstanding lines', rows.length),
      stat('Different items', distinct(rows.map((r) => r.sku))),
      dates.length ? stat('Oldest issue still out', dates[0].slice(0, 10)) : null,
    ].filter(Boolean)
  },
  events: (rows) => [
    stat('Events', rows.length),
    stat('Upcoming', countBy(rows, (r) => r.status === 'upcoming')),
    stat('Active', countBy(rows, (r) => r.status === 'active')),
    stat('Completed', countBy(rows, (r) => r.status === 'completed')),
    stat('Stock transactions', rows.reduce((n, r) => n + Number(r.txns || 0), 0)),
  ],
  'event-usage': (rows) => [
    stat('Events covered', distinct(rows.map((r) => r.event))),
    stat('Different items', distinct(rows.map((r) => r.sku))),
    stat('Usage lines', rows.length),
  ],
  faults: (rows) => {
    const open = rows.filter((r) => r.status === 'Open')
    return [
      stat('Faults reported', rows.length),
      stat('Open', open.length),
      stat('Resolved', rows.length - open.length),
      stat('Open - out of service', countBy(open, (r) => String(r.canIssue).startsWith('No'))),
      stat('Items affected', distinct(rows.map((r) => r.sku))),
      open.length ? stat('Oldest open (days)', Math.max(...open.map((r) => Number(r.daysOpen || 0)))) : null,
    ].filter(Boolean)
  },
  units: (rows) => [
    stat('Units defined', rows.length),
    stat('Base units', countBy(rows, (r) => r.base === 'Yes')),
    stat('Unit assignments to items', rows.reduce((n, r) => n + Number(r.items || 0), 0)),
  ],
  users: (rows) => [
    stat('Accounts', rows.length),
    stat('Admins', countBy(rows, (r) => r.role === 'admin')),
    stat('Other roles', countBy(rows, (r) => r.role !== 'admin')),
  ],
}

/** The ledger can be huge and streams, so its overview is one aggregate query instead of a pass over the rows. */
async function ledgerOverview(p) {
  const { args, where } = ledgerFilter(p)
  const { rows } = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.type = 'receive') AS receives,
            COUNT(*) FILTER (WHERE t.type = 'issue') AS issues,
            COUNT(*) FILTER (WHERE t.type = 'return') AS returns,
            COUNT(DISTINCT t.item_id) AS items,
            COUNT(DISTINCT NULLIF(btrim(t.recipient), '')) AS recipients,
            to_char(MIN(t.created_at) AT TIME ZONE $1, 'YYYY-MM-DD') AS first_day,
            to_char(MAX(t.created_at) AT TIME ZONE $1, 'YYYY-MM-DD') AS last_day
     FROM transactions t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    args
  )
  const r = rows[0] || {}
  return [
    stat('Transactions', Number(r.total || 0)),
    stat('Received', Number(r.receives || 0)),
    stat('Issued', Number(r.issues || 0)),
    stat('Returned', Number(r.returns || 0)),
    stat('Different items', Number(r.items || 0)),
    stat('Recipients', Number(r.recipients || 0)),
    r.first_day ? stat('First movement', r.first_day) : null,
    r.last_day ? stat('Latest movement', r.last_day) : null,
  ].filter(Boolean)
}

/**
 * Headline figures for a report. `rows` are every row the report will contain (before any column choice);
 * the ledger passes nothing because it streams. Never throws: an overview problem must not block a download.
 */
export async function buildOverview(id, params, rows) {
  try {
    if (id === 'transactions') return await ledgerOverview(params)
    if (id === 'receipts') return await receiptsOverview(params)
    const fn = OVERVIEWS[id]
    return fn && rows ? fn(rows) : []
  } catch (e) {
    console.error('[export] overview failed', e)
    return []
  }
}

/** Plain-language list of the filters that shaped a report (only the ones that report supports). */
export function describeFilters(dataset, p) {
  const has = (f) => dataset.filters?.includes(f)
  const out = []
  if (has('search') && p.search) out.push(`Search: "${p.search}"`)
  if (has('category') && p.category) out.push(`Category: ${p.category}`)
  if (has('itemType') && p.itemType) out.push(`Item type: ${p.itemType}`)
  if (has('type') && p.type) out.push(`Transaction type: ${p.type}`)
  if (has('status') && p.status) out.push(`Status: ${p.status}`)
  if (has('outType') && p.outType && p.outType !== 'expected') out.push(`Stock type: ${p.outType}`)
  if (has('faultStatus') && p.faultStatus !== 'all') out.push(`Fault status: ${p.faultStatus}`)
  if (has('usability') && p.usability) out.push(`Usability: ${p.usability}`)
  if (has('range') && (p.from || p.to)) out.push(`${dataset.rangeLabel || 'Date range'}: ${p.from || 'start'} to ${p.to || 'today'}`)
  if (p.lowStock) out.push('Low stock only')
  return out.length ? out : ['None (all records)']
}

export const DATASETS = {
  inventory: {
    title: 'Inventory',
    description: 'Every item with stock on hand, what is out on issue, reorder level and location.',
    group: 'Stock',
    filters: ['search', 'category', 'itemType'],
    columns: [
      col('sku', 'SKU'), col('name', 'Name'), col('category', 'Category'), col('type', 'Type'),
      col('available', 'Available Qty'), col('outstanding', 'Issued Out'), col('total', 'Total Qty'),
      col('unit', 'Unit'), col('reorder', 'Reorder Level'), col('status', 'Status'),
      col('location', 'Location'), col('loose', 'Loose Pieces (kits)'), col('description', 'Description'),
      col('created', 'Created'), col('updated', 'Last Updated'),
    ],
    rows: inventoryRows,
  },
  'low-stock': {
    title: 'Low stock / reorder list',
    description: 'Items at or below their reorder level.',
    group: 'Stock',
    filters: ['category'],
    columns: [
      col('sku', 'SKU'), col('name', 'Name'), col('category', 'Category'), col('type', 'Type'),
      col('available', 'Available Qty'), col('reorder', 'Reorder Level'), col('unit', 'Unit'),
      col('location', 'Location'),
    ],
    rows: lowStockRows,
  },
  'kit-contents': {
    title: 'Tool kit contents',
    description: 'Every piece inside each kit: per set, loose, in store and currently out.',
    group: 'Stock',
    filters: ['search'],
    columns: [
      col('sku', 'Kit SKU'), col('kit', 'Kit'), col('piece', 'Piece'), col('perSet', 'Per Set'),
      col('loose', 'Loose'), col('inStore', 'In Store (pcs)'), col('out', 'Out (pcs)'), col('notes', 'Notes'),
    ],
    rows: kitRows,
  },
  outstanding: {
    title: 'Stock currently out',
    description: 'Who has what: reusable items, kits and (optionally) consumables not yet returned.',
    group: 'Movements',
    filters: ['outType', 'search'],
    columns: [
      col('recipient', 'Recipient'), col('department', 'Department'), col('sku', 'SKU'), col('item', 'Item'),
      col('type', 'Type'), col('outstanding', 'Outstanding'), col('unit', 'Unit'),
      col('pieces', 'Pieces Out (kits)'), col('pieceList', 'Pieces'), col('lastIssued', 'Last Issued'),
    ],
    rows: outstandingRows,
  },
  transactions: {
    title: 'Transaction ledger',
    description: 'Every receive, issue and return, newest first. Filter by date, type, item or event.',
    group: 'Movements',
    filters: ['range', 'type'],
    columns: [
      col('date', 'Date'), col('time', 'Time'), col('type', 'Type'), col('sku', 'SKU'), col('item', 'Item'),
      col('line', 'Line'), col('piece', 'Kit Piece'), col('qty', 'Quantity'), col('unit', 'Unit'),
      col('baseQty', 'Quantity (base)'), col('baseUnit', 'Base Unit'), col('source', 'Source'),
      col('event', 'Event'), col('vendor', 'Vendor'), col('recipient', 'Recipient'),
      col('department', 'Department'), col('by', 'Performed By'), col('notes', 'Notes'),
      col('id', 'Transaction ID'),
    ],
    pdfDefault: [
      'date', 'time', 'type', 'sku', 'item', 'line', 'piece', 'qty', 'unit', 'source',
      'event', 'vendor', 'recipient', 'department', 'by', 'notes',
    ],
    rows: ledgerRows,
    streams: true,
  },
  receipts: {
    title: 'Receipt history',
    description: 'Every stock receipt (from head office or a vendor), newest first. Filter by date, item or search.',
    group: 'Movements',
    filters: ['range', 'search'],
    columns: [
      col('date', 'Date'), col('time', 'Time'), col('sku', 'SKU'), col('item', 'Item'),
      col('line', 'Line'), col('piece', 'Kit Piece'), col('qty', 'Quantity'), col('unit', 'Unit'),
      col('source', 'Received From'), col('vendor', 'Vendor'), col('by', 'Recorded By'),
      col('notes', 'Notes'), col('id', 'Transaction ID'),
    ],
    pdfDefault: ['date', 'time', 'sku', 'item', 'line', 'piece', 'qty', 'unit', 'source', 'vendor', 'by', 'notes'],
    rows: receiptRows,
    streams: true,
  },
  events: {
    title: 'Events',
    description: 'All events with dates, status and number of stock transactions.',
    group: 'Events',
    filters: ['range', 'status'],
    rangeLabel: 'Event start date',
    columns: [
      col('name', 'Event'), col('status', 'Status'), col('location', 'Location'), col('start', 'Start Date'),
      col('end', 'End Date'), col('txns', 'Stock Transactions'), col('description', 'Description'),
    ],
    rows: eventRows,
  },
  'event-usage': {
    title: 'Stock used per event',
    description: 'Issued, returned and net quantity of each item for every event.',
    group: 'Events',
    filters: ['range'],
    columns: [
      col('event', 'Event'), col('start', 'Event Start'), col('sku', 'SKU'), col('item', 'Item'),
      col('issued', 'Issued'), col('returned', 'Returned'), col('net', 'Net Used'),
      col('received', 'Received'), col('unit', 'Unit'),
    ],
    rows: eventUsageRows,
  },
  faults: {
    title: 'Faulty items register',
    description: 'Every reported fault: what is wrong, whether the item can still be issued (and how), who reported it and how it was resolved.',
    group: 'Faults',
    filters: ['range', 'faultStatus', 'usability', 'search'],
    rangeLabel: 'Reported between',
    columns: [
      col('reported', 'Reported'), col('sku', 'SKU'), col('item', 'Item'), col('piece', 'Kit Piece'),
      col('qty', 'Qty Affected'), col('unit', 'Unit'), col('fault', 'Fault'), col('canIssue', 'Can Be Issued?'),
      col('workaround', 'Workaround / How To Use'), col('foundWith', 'Found With'), col('status', 'Status'),
      col('reportedBy', 'Reported By'), col('resolution', 'Resolution'), col('resolutionNotes', 'Resolution Notes'),
      col('resolved', 'Resolved'), col('resolvedBy', 'Resolved By'), col('daysOpen', 'Days Open'),
    ],
    rows: faultRows,
  },
  units: {
    title: 'Units of measurement',
    description: 'Units, their conversion factors and how many items use each.',
    group: 'Setup',
    filters: [],
    columns: [
      col('name', 'Unit'), col('abbr', 'Abbreviation'), col('factor', 'Conversion Factor'),
      col('base', 'Base Unit'), col('items', 'Items Using It'),
    ],
    rows: unitRows,
  },
  users: {
    title: 'Users',
    description: 'Accounts and roles (no passwords).',
    group: 'Setup',
    adminOnly: true,
    filters: [],
    columns: [col('name', 'Name'), col('username', 'Username'), col('role', 'Role'), col('site', 'Site'), col('created', 'Created')],
    rows: userRows,
  },
}

/** What the Reports & Exports page may list for this user. */
export function catalog(isAdmin) {
  return Object.entries(DATASETS)
    .filter(([, d]) => isAdmin || !d.adminOnly)
    .map(([id, d]) => ({
      id,
      title: d.title,
      description: d.description,
      group: d.group,
      filters: d.filters,
      rangeLabel: d.rangeLabel || 'Date range',
      columns: d.columns.map((c) => c.label), // kept for older clients
      columnDefs: d.columns.map((c) => ({ key: c.key, label: c.label })),
      pdfDefault: d.pdfDefault || null, // columns pre-selected for PDF when the user has not chosen any
    }))
}

/**
 * Narrow a dataset's columns to the ones the caller asked for (`columns=sku,item,notes`).
 * Keeps the dataset's own column order, ignores duplicates, and rejects unknown keys so a typo
 * is a clear 400 instead of a silently empty report. No/blank value = all columns (unchanged behaviour).
 */
export function pickColumns(dataset, requested) {
  const raw = Array.isArray(requested) ? requested.join(',') : requested
  if (raw == null || String(raw).trim() === '') return dataset.columns
  const wanted = new Set(String(raw).split(',').map((k) => k.trim()).filter(Boolean))
  if (wanted.size > 100) throw bad('Too many columns requested')
  const known = new Set(dataset.columns.map((c) => c.key))
  for (const k of wanted) if (!known.has(k)) throw bad(`Unknown column "${k.slice(0, 40)}"`)
  const cols = dataset.columns.filter((c) => wanted.has(c.key))
  if (!cols.length) throw bad('Choose at least one column')
  return cols
}

// ---------------------------------------------------------------------------------------
// Whole-database JSON export (admin) – for portability / analysis, not a restore file
// ---------------------------------------------------------------------------------------

const FULL_TABLES = [
  ['sites', 'SELECT * FROM sites ORDER BY created_at, id'],
  ['units', 'SELECT * FROM units ORDER BY created_at, id'],
  ['events', 'SELECT * FROM events ORDER BY created_at, id'],
  ['items', 'SELECT * FROM items ORDER BY created_at, id'],
  ['item_units', 'SELECT * FROM item_units ORDER BY item_id, unit_id'],
  ['item_faults', 'SELECT * FROM item_faults ORDER BY reported_at, id'],
  ['kit_components', 'SELECT * FROM kit_components ORDER BY kit_id, position, id'],
  ['app_settings', 'SELECT key, value, updated_at FROM app_settings ORDER BY key'],
  ['categories', 'SELECT * FROM categories ORDER BY lower(name), id'],
  ['recipients', 'SELECT * FROM recipients ORDER BY lower(name), id'],
  ['recipient_audit', 'SELECT * FROM recipient_audit ORDER BY created_at, id'],
  // password hashes never leave the database
  ['users', 'SELECT id, username, name, role, site_id, created_at FROM users ORDER BY created_at, id'],
]

/** Yields JSON text chunks for the whole database. */
export async function* fullExportChunks() {
  yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"format":"inventory-full-export","version":1,"tables":{`
  for (const [name, sql] of FULL_TABLES) {
    const { rows } = await query(sql)
    yield `${JSON.stringify(name)}:${JSON.stringify(rows)},`
  }
  // the ledger can be large: stream it in batches, oldest first
  yield '"transactions":['
  let cursor = null
  let first = true
  for (;;) {
    const { rows } = await query(
      `SELECT t.*, t.created_at::text AS created_raw FROM transactions t
       ${cursor ? 'WHERE (t.created_at, t.id) > ($1::timestamptz, $2::uuid)' : ''}
       ORDER BY t.created_at, t.id LIMIT ${BATCH}`,
      cursor ? [cursor.created, cursor.id] : []
    )
    if (!rows.length) break
    const out = rows.map(({ created_raw, ...r }) => JSON.stringify(r)).join(',')
    yield (first ? '' : ',') + out
    first = false
    if (rows.length < BATCH) break
    cursor = { created: rows[rows.length - 1].created_raw, id: rows[rows.length - 1].id }
  }
  yield ']}}'
}

// ---------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------

/**
 * One CSV cell, RFC 4180 style, and safe to open in a spreadsheet: text that would be run
 * as a formula (= + - @ tab CR at the start) is defused with a leading apostrophe.
 */
export function csvCell(v) {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (v instanceof Date) return v.toISOString()
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvLine = (cells) => `${cells.map(csvCell).join(',')}\r\n`
