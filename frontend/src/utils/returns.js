// Helpers shared by the Return Stock screens.

/** Reasons offered when a consumable comes back (stored at the start of the ledger note). */
export const CONSUMABLE_REASONS = [
  'Wrong item issued / changed their mind',
  'Issued by mistake',
  'Unused surplus',
  'Other',
]

/** Name of the base unit an item is counted in ("pcs" when it has none). */
export function baseUnitLabel(item, units) {
  return units.find((u) => u.id === item?.baseUnitId)?.abbreviation || 'pcs'
}

/** Total loose pieces of a kit still out against one balance row. */
export const piecesOut = (balance) =>
  (balance.components || []).reduce((t, c) => t + c.outstanding, 0)

/** Join the optional parts of a ledger note. */
export const joinNotes = (...parts) => parts.map((p) => String(p || '').trim()).filter(Boolean).join(' · ')

/** "5 sets" / "1 set" */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
