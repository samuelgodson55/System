// Helpers for per-item units of measurement.
// An item only offers the units listed in `item.unitIds` (its base unit is always included).

/** Units an item can be received / issued / returned in, base unit first. */
export function unitsForItem(item, units) {
  if (!item || !Array.isArray(item.unitIds) || item.unitIds.length === 0) return units
  const allowed = new Set(item.unitIds)
  if (item.baseUnitId) allowed.add(item.baseUnitId)
  return units
    .filter((u) => allowed.has(u.id))
    .sort((a, b) => (b.id === item.baseUnitId) - (a.id === item.baseUnitId))
}

/** The unit a form should start on for this item. */
export function defaultUnitId(item, units) {
  const options = unitsForItem(item, units)
  return (
    options.find((u) => u.id === item?.baseUnitId)?.id ||
    options.find((u) => u.isBase)?.id ||
    options[0]?.id ||
    ''
  )
}

/** Base units in ONE `u` for this item (the item's own factor wins over the unit's default). */
export function factorFor(u, item) {
  return item?.unitFactors?.[u.id] ?? u.conversionFactor
}

/** True when the item is counted in the system base unit (pieces), as every item used to be. */
export function usesSystemBase(item, units) {
  const base = units.find((u) => u.id === item?.baseUnitId)
  return !base || base.isBase
}

/**
 * Label for the unit an item's stock is counted in. Items counted in pieces keep the familiar
 * "pcs"; items counted in something else (litres, kg ...) show that unit's abbreviation.
 */
export function baseAbbr(item, units) {
  if (usesSystemBase(item, units)) return 'pcs'
  return units.find((u) => u.id === item.baseUnitId)?.abbreviation || 'pcs'
}

/** Quantities are stored with 4 decimals; show them without floating-point noise (188, 0.5, 12.25). */
export function fmtQty(n) {
  const v = Math.round(Number(n) * 10000) / 10000
  return Number.isFinite(v) ? String(v) : ''
}

/** "Pack (pk) — 12 pcs" / "Drum (drum) — 208 L" */
export function unitOptionLabel(u, item, units = []) {
  const f = factorFor(u, item)
  const isItemBase = item?.baseUnitId ? u.id === item.baseUnitId : u.isBase
  const abbr = units.length ? baseAbbr(item, units) : 'pcs'
  return `${u.name} (${u.abbreviation})${!isItemBase && f !== 1 ? ` — ${fmtQty(f)} ${abbr}` : ''}`
}

/**
 * How many of unit `u` make ONE of the item's base unit, for units set up that way
 * ("Piece: 48 per pack"), else null. The exact inverse of the factor: 1 piece = 1/48 pack.
 */
export function perBaseFor(u, item) {
  const n = item?.unitsPerBase?.[u?.id]
  return n != null && Number(n) > 0 ? Number(n) : null
}

/**
 * Suggest "N per base unit" for a stored factor that is (almost) 1/N: an old 1 piece = 0.0208 pk
 * was really 1/48. Returns N, or null when the factor is not a simple fraction of the base unit.
 */
export function suggestPerBase(factor) {
  const f = Number(factor)
  if (!(f > 0) || f >= 1) return null
  const n = Math.round(1 / f)
  return n >= 2 && Math.abs(1 / f - n) / n < 0.005 ? n : null
}

/**
 * Stock split into whole base units plus whole smallest units, e.g. 5.9792 pk -> "5 pk 47 pc".
 * Only for items that have a smaller unit set up as "N per base unit" and a stock that is a whole
 * number of those; returns null otherwise (nothing to explain).
 */
export function stockBreakdown(item, units, stock = item?.quantity) {
  if (!item || !item.unitsPerBase) return null
  let finest = null
  for (const [id, n] of Object.entries(item.unitsPerBase)) {
    if (Number(n) > 1 && Number.isInteger(Number(n)) && (!finest || Number(n) > finest.n)) finest = { id, n: Number(n) }
  }
  if (!finest) return null
  const total = Number(stock) * finest.n
  if (!Number.isFinite(total) || Math.abs(total - Math.round(total)) > 1e-3) return null
  const pieces = Math.round(total)
  const whole = Math.floor(pieces / finest.n)
  const rest = pieces - whole * finest.n
  if (rest === 0) return null
  const sub = units.find((u) => u.id === finest.id)
  const parts = []
  if (whole > 0) parts.push(`${whole.toLocaleString()} ${baseAbbr(item, units)}`)
  parts.push(`${rest.toLocaleString()} ${sub?.abbreviation || ''}`.trim())
  return parts.join(' ')
}
