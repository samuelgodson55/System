/**
 * "Everything that is out" – one row per item + recipient + department, across the whole
 * inventory, grouped for display by person or by item.
 *
 *  - reusable items and kits: balance = issued − returned (they are expected back)
 *  - consumables: balance = issued − returned too, but they are normally used up, so they
 *    are only listed when asked for and only for issues in the last `days` days
 *
 * Search and grouping are done here (not in SQL) so a kit row can be matched by one of its
 * pieces and shows the same numbers whatever the search is. The result set is bounded by
 * what is currently out, so this stays small.
 */
import { query } from '../db/pool.js'

const TYPE_SETS = {
  expected: ['reusable', 'kit'],
  consumable: ['consumable'],
  all: ['reusable', 'kit', 'consumable'],
}

const num = (v, fallback, min, max) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
}

export async function listOutstanding({ search, type, days, groupBy, department, page, limit, siteId }) {
  // balances are always per site (an item belongs to one site); never list across sites by accident
  if (!siteId) throw new Error('listOutstanding needs a siteId')
  const types = TYPE_SETS[type] || TYPE_SETS.expected
  const windowDays = num(days, 30, 1, 365)

  const [topRes, compRes] = await Promise.all([
    query(
      `SELECT t.item_id, t.recipient, COALESCE(t.department, '') AS department,
              i.name AS item_name, i.sku, i.item_type, bu.abbreviation AS base_unit,
              SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
            - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) AS bal,
              MAX(t.created_at) FILTER (WHERE t.type = 'issue') AS last_issued
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       LEFT JOIN units bu ON bu.id = i.base_unit_id
       WHERE t.component_id IS NULL AND t.recipient IS NOT NULL AND t.recipient <> ''
         AND i.item_type = ANY($1) AND i.site_id = $3
       GROUP BY t.item_id, t.recipient, COALESCE(t.department, ''),
                i.name, i.sku, i.item_type, bu.abbreviation
       HAVING SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
            - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) > 0.000001
          AND (i.item_type <> 'consumable'
               OR MAX(t.created_at) FILTER (WHERE t.type = 'issue') >= NOW() - make_interval(days => $2::int))`,
      [types, windowDays, siteId]
    ),
    // pieces of kits that are out (also covers people who only borrowed a single piece)
    types.includes('kit')
      ? query(
          `SELECT t.item_id, t.recipient, COALESCE(t.department, '') AS department,
                  i.name AS item_name, i.sku, i.item_type,
                  kc.id AS component_id, kc.name AS component_name, kc.quantity_per_kit, kc.position,
                  SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
                - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) AS bal,
                  MAX(t.created_at) FILTER (WHERE t.type = 'issue') AS last_issued
           FROM transactions t
           JOIN items i ON i.id = t.item_id
           JOIN kit_components kc ON kc.id = t.component_id
           WHERE t.component_id IS NOT NULL AND t.recipient IS NOT NULL AND t.recipient <> ''
             AND i.site_id = $1
           GROUP BY t.item_id, t.recipient, COALESCE(t.department, ''), i.name, i.sku, i.item_type,
                    kc.id, kc.name, kc.quantity_per_kit, kc.position
           HAVING SUM(CASE WHEN t.type = 'issue' THEN t.quantity ELSE 0 END)
                - SUM(CASE WHEN t.type = 'return' THEN t.quantity ELSE 0 END) > 0`,
          [siteId]
        )
      : Promise.resolve({ rows: [] }),
  ])

  const lines = new Map()
  const line = (r) => {
    const key = `${r.item_id}\u0000${r.recipient}\u0000${r.department}`
    if (!lines.has(key)) {
      lines.set(key, {
        itemId: r.item_id,
        itemName: r.item_name,
        sku: r.sku,
        itemType: r.item_type,
        recipient: r.recipient,
        department: r.department,
        outstanding: 0,
        unit: r.item_type === 'kit' ? 'sets' : r.base_unit || 'pcs',
        lastIssuedAt: null,
        components: [],
      })
    }
    return lines.get(key)
  }
  const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b)

  for (const r of topRes.rows) {
    const l = line(r)
    l.outstanding = Math.round(Number(r.bal) * 1e8) / 1e8
    l.lastIssuedAt = later(l.lastIssuedAt, r.last_issued)
  }
  for (const r of compRes.rows) {
    const l = line(r)
    l.components.push({
      componentId: r.component_id,
      name: r.component_name,
      quantityPerKit: r.quantity_per_kit,
      outstanding: Math.round(Number(r.bal) * 1e8) / 1e8,
      position: r.position,
    })
    l.lastIssuedAt = later(l.lastIssuedAt, r.last_issued)
  }

  const q = String(search || '').trim().toLowerCase()
  let list = [...lines.values()]
  // departments that have something out (before search / department filter), for the filter list
  const deptLabel = (d) => d || ''
  const deptMap = new Map()
  for (const l of list) {
    const k = deptLabel(l.department).toLowerCase()
    if (!deptMap.has(k)) deptMap.set(k, { name: deptLabel(l.department), people: new Set(), lines: 0 })
    const e = deptMap.get(k)
    e.people.add(l.recipient.toLowerCase())
    e.lines += 1
  }
  const departments = [...deptMap.values()]
    .map((d) => ({ name: d.name, people: d.people.size, lines: d.lines }))
    .sort((a, b) => (a.name || '\uffff').localeCompare(b.name || '\uffff', undefined, { sensitivity: 'base' }))
  const deptFilter = String(department ?? '').trim().toLowerCase()
  if (deptFilter) {
    // "__none__" = items issued without any department
    list = list.filter((l) =>
      deptFilter === '__none__' ? !l.department : String(l.department || '').toLowerCase() === deptFilter
    )
  }
  for (const l of list) l.components.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  if (q) {
    list = list.filter((l) =>
      [l.recipient, l.department, l.itemName, l.sku, ...l.components.map((c) => c.name)]
        .some((s) => String(s || '').toLowerCase().includes(q))
    )
  }

  // headline numbers cover everything that matches, not just the current page
  const summary = {
    lines: list.length,
    people: new Set(list.map((l) => `${l.recipient}\u0000${l.department}`)).size,
    items: new Set(list.map((l) => l.itemId)).size,
  }

  const byItem = groupBy === 'item'
  const byDept = groupBy === 'department'
  const groups = new Map()
  for (const l of list) {
    const key = byItem
      ? l.itemId
      : byDept
        ? `dept\u0000${String(l.department || '').toLowerCase()}`
        : `${l.recipient}\u0000${l.department}`
    if (!groups.has(key)) {
      groups.set(key, byItem
        ? { key, label: l.itemName, sublabel: l.sku, itemType: l.itemType, lines: [] }
        : byDept
          ? { key, label: l.department || 'No department', sublabel: '', lines: [] }
          : { key, label: l.recipient, sublabel: l.department, lines: [] })
    }
    groups.get(key).lines.push(l)
  }
  if (byDept) {
    for (const g of groups.values()) {
      const people = new Set(g.lines.map((l) => l.recipient.toLowerCase())).size
      g.people = people
      g.sublabel = `${people} ${people === 1 ? 'person' : 'people'}`
    }
  }
  const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
  const sorted = [...groups.values()]
  for (const g of sorted) {
    g.lines.sort(byItem
      ? (a, b) => cmp(a.recipient, b.recipient) || cmp(a.department, b.department)
      : byDept
        ? (a, b) => cmp(a.itemName, b.itemName) || cmp(a.recipient, b.recipient)
        : (a, b) => cmp(a.itemName, b.itemName))
  }
  sorted.sort((a, b) => cmp(a.label, b.label) || cmp(a.sublabel, b.sublabel))

  const lim = num(limit, 10, 1, 50)
  const pg = num(page, 1, 1, 1e6)
  return {
    groups: sorted.slice((pg - 1) * lim, pg * lim),
    total: sorted.length,
    page: pg,
    limit: lim,
    summary,
    type: TYPE_SETS[type] ? type : 'expected',
    groupBy: byItem ? 'item' : byDept ? 'department' : 'recipient',
    department: deptFilter ? String(department).trim() : '',
    departments,
    days: windowDays,
  }
}
