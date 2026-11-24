/**
 * Search helpers for the "Stock Used" / "Totals by item" tables.
 * Pure functions: they only read rows already on screen, so they cannot affect stored data.
 */

/** Lower-cased, trimmed search text ("" when nothing useful was typed). */
export const normaliseQuery = (q) => String(q || '').trim().toLowerCase()

/**
 * Keep rows where EVERY word typed appears in the row's searchable text (any order),
 * so "ladder 5" finds "5-Step Ladder". `fields(row)` returns the strings to look in.
 */
export function filterBySearch(rows, query, fields) {
  const words = normaliseQuery(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter((row) => {
    const hay = fields(row)
      .filter((v) => v !== null && v !== undefined && v !== '')
      .join(' ')
      .toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/**
 * Sum a numeric field over rows, but only when every row uses the same unit
 * (adding "3 pk" to "4 pcs" would be meaningless). Returns { total, unit } or null.
 */
export function sumIfSameUnit(rows, valueOf, unitOf) {
  if (rows.length === 0) return null
  const unit = unitOf(rows[0]) || ''
  if (!rows.every((r) => (unitOf(r) || '') === unit)) return null
  const total = rows.reduce((s, r) => s + (Number(valueOf(r)) || 0), 0)
  return { total: Math.round(total * 1000) / 1000, unit }
}
