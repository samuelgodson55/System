/**
 * Headline figures ("Report overview") and filter descriptions for the exports built in the browser.
 * Pure functions: they only read the rows already on screen, so they cannot affect any data.
 */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const fmt = (v) => n(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
const uniq = (list) => new Set(list.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))

/** Inventory page: items (kits counted once; their pieces are separate). */
export function inventoryOverview(items, { categoryCount } = {}) {
  const list = items || []
  const type = (i) => i.itemType || 'consumable'
  const count = (t) => list.filter((i) => type(i) === t).length
  const low = list.filter((i) => n(i.quantity) <= n(i.reorderLevel))
  const outOfStock = list.filter((i) => n(i.quantity) <= 0)
  const issuedOut = list.filter((i) => n(i.outstanding) > 0)
  const kits = list.filter((i) => type(i) === 'kit')
  const pieces = kits.reduce((t, k) => t + (k.components?.length || 0), 0)
  return [
    { label: 'Total SKUs in store', value: fmt(list.length) },
    { label: 'Consumables', value: fmt(count('consumable')) },
    { label: 'Reusable items', value: fmt(count('reusable')) },
    { label: 'Kits', value: fmt(kits.length) },
    pieces ? { label: 'Kit pieces listed', value: fmt(pieces) } : null,
    { label: 'Categories', value: fmt(categoryCount ?? uniq(list.map((i) => i.category)).size) },
    { label: 'Low stock (at/below reorder)', value: fmt(low.length) },
    { label: 'Out of stock', value: fmt(outOfStock.length) },
    { label: 'Items currently issued out', value: fmt(issuedOut.length) },
  ].filter(Boolean)
}

/** Daily Issues page: top-level issue lines for the day (piece lines belong to their kit). */
export function dailyIssuesOverview(entries) {
  const top = (entries || []).filter((e) => !e.parentTxnId)
  return [
    { label: 'Issue transactions', value: fmt(top.length) },
    { label: 'Different items', value: fmt(uniq(top.map((e) => e.itemSku || e.itemName)).size) },
    { label: 'Recipients', value: fmt(uniq(top.map((e) => e.recipient)).size) },
    { label: 'Departments', value: fmt(uniq(top.map((e) => e.department)).size) },
    { label: 'Events', value: fmt(uniq(top.map((e) => e.eventName)).size) },
    { label: 'Issued by', value: fmt(uniq(top.map((e) => e.performedBy)).size) },
  ]
}

/** Transaction lists (item history, event stock). */
export function transactionsOverview(txns, { currentStock } = {}) {
  const list = txns || []
  const by = (t) => list.filter((x) => x.type === t)
  const dates = list.map((x) => x.createdAt).filter(Boolean).sort()
  const day = (d) => (d ? String(d).slice(0, 10) : '')
  return [
    { label: 'Total transactions', value: fmt(list.length) },
    { label: 'Received', value: fmt(by('receive').length) },
    { label: 'Issued', value: fmt(by('issue').length) },
    { label: 'Returned', value: fmt(by('return').length) },
    { label: 'Recipients', value: fmt(uniq(list.map((x) => x.recipient)).size) },
    currentStock != null ? { label: 'Current stock', value: currentStock } : null,
    dates.length ? { label: 'First movement', value: day(dates[0]) } : null,
    dates.length ? { label: 'Latest movement', value: day(dates[dates.length - 1]) } : null,
  ].filter(Boolean)
}

/** Readable description of the filters on the inventory page. */
export function inventoryFilters({ search, category, type, lowOnly } = {}) {
  const list = [
    search ? `Search: "${search}"` : null,
    category ? `Category: ${category}` : null,
    type ? `Type: ${type}` : null,
    lowOnly ? 'Low stock only' : null,
  ].filter(Boolean)
  return list.length ? list : ['None (all items)']
}

/**
 * Readable event dates for exports, e.g. "Nov 23, 2026" or "Nov 23, 2026 to Nov 25, 2026".
 * Accepts plain dates or full ISO timestamps (the API may return either) and uses only the
 * calendar-date part, so a timestamp such as 2026-11-23T00:00:00.000Z can never shift a day or spill raw
 * text into the report. Falls back to the original text when a value is not a recognisable date.
 */
export function eventDatesLabel(startDate, endDate) {
  const pretty = (raw) => {
    if (!raw) return ''
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return String(raw)
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const a = pretty(startDate)
  const b = pretty(endDate)
  return a && b && a !== b ? `${a} to ${b}` : a || b
}
