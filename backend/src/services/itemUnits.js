/**
 * Per-item units of measurement.
 *
 * Not every unit makes sense for every item (pens come in packs and cartons, a folding
 * table does not). `item_units` lists the units an item may be received, issued and
 * returned in. The item's base unit is always allowed.
 *
 * Every function that takes `db` accepts a pg client or the pool's `query` wrapper
 * ({ query }) so it can run inside or outside a transaction.
 */
import { HttpError } from './kits.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Unique, well-formed ids with the base unit first. Throws 400 on malformed ids. */
export function normalizeUnitIds(baseUnitId, unitIds) {
  const list = Array.isArray(unitIds) ? unitIds : []
  for (const id of list) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(400, 'Invalid unit selected')
  }
  return [...new Set([baseUnitId, ...list].filter(Boolean))]
}

/**
 * Stock is stored with 10 decimals (items.quantity / transactions.quantity are NUMERIC(22,10)).
 * 4 decimals were not enough for a unit like "1 piece = 1/48 pack" (0.020833...), which silently
 * became 0.0208 and made 6 packs read as 288.46 pieces.
 */
export const QTY_DECIMALS = 10
/** Anything smaller than this is rounding dust, never a real quantity (1e-6 of a base unit). */
export const QTY_EPSILON = 1e-6
export const roundQty = (n) => Math.round(Number(n) * 1e10) / 1e10
/** For showing / returning a quantity: removes the last digits of rounding dust (0.9999999984 -> 1). */
export const tidyQty = (n) => Math.round(Number(n) * 1e8) / 1e8

/** Positive number or null (null = use the unit's default factor). */
function cleanFactor(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Conversion factors must be greater than 0')
  return roundQty(n)
}

/**
 * "How many of this unit make ONE base unit" (48 pieces per pack), the exact inverse of a factor.
 * Positive number or null. Kept at 4 decimals: it is a count a person types, not a measurement.
 */
function cleanPerBase(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Units per base unit must be greater than 0')
  return Math.round(n * 10000) / 10000
}

/**
 * Make the item's allowed units exactly `unitIds` (+ its base unit), with optional
 * per-item conversion factors `unitFactors` ({ [unitId]: baseUnitsPerUnit }) and/or exact
 * inverses `unitsPerBase` ({ [unitId]: unitsPerOneBaseUnit }), e.g. a pack-counted tissue item:
 * { piece: 48 } means 1 pack = 48 pieces, i.e. 1 piece = 1/48 pack exactly. When both are given
 * for the same unit the inverse wins.
 * Pass `unitIds === undefined` to leave the selection untouched (the base unit is
 * still guaranteed to be present).
 */
export async function syncItemUnits(db, itemId, baseUnitId, unitIds, unitFactors, unitsPerBase) {
  const wanted = normalizeUnitIds(baseUnitId, unitIds === undefined ? [] : unitIds)

  if (wanted.length) {
    const { rows } = await db.query('SELECT id FROM units WHERE id = ANY($1::uuid[])', [wanted])
    if (rows.length !== wanted.length) throw new HttpError(400, 'One of the selected units no longer exists')
  }

  // When the item is counted in something other than the system's base unit (litres, kg ...),
  // a unit's default factor is measured in the wrong thing, so every unit newly added to the
  // item must say how many of the item's own base unit it holds (1 Drum = 208 L). Units the
  // item already had are left alone, so existing items keep saving exactly as before.
  if (unitIds !== undefined && baseUnitId) {
    const { rows: baseRows } = await db.query('SELECT is_base, abbreviation FROM units WHERE id = $1', [baseUnitId])
    if (baseRows.length && !baseRows[0].is_base) {
      const { rows: have } = await db.query('SELECT unit_id FROM item_units WHERE item_id = $1', [itemId])
      const had = new Set(have.map((r) => r.unit_id))
      const added = wanted.filter((id) => id !== baseUnitId && !had.has(id))
      for (const id of added) {
        const f = unitFactors && typeof unitFactors === 'object' ? cleanFactor(unitFactors[id]) : null
        const pb = unitsPerBase && typeof unitsPerBase === 'object' ? cleanPerBase(unitsPerBase[id]) : null
        if (f === null && pb === null) {
          const { rows: u } = await db.query('SELECT name FROM units WHERE id = $1', [id])
          throw new HttpError(
            400,
            `Enter how many ${baseRows[0].abbreviation} are in one ${u[0]?.name || 'unit'} (this item is counted in ${baseRows[0].abbreviation})`
          )
        }
      }
    }
  }

  if (unitIds !== undefined) {
    await db.query('DELETE FROM item_units WHERE item_id = $1 AND NOT (unit_id = ANY($2::uuid[]))', [
      itemId,
      wanted,
    ])
  }
  if (wanted.length) {
    await db.query(
      `INSERT INTO item_units (item_id, unit_id)
       SELECT $1, u FROM unnest($2::uuid[]) AS u
       ON CONFLICT DO NOTHING`,
      [itemId, wanted]
    )
  }
  const hasFactors = !!unitFactors && typeof unitFactors === 'object'
  const hasPerBase = !!unitsPerBase && typeof unitsPerBase === 'object'
  if (hasFactors || hasPerBase) {
    for (const id of wanted) {
      if (id === baseUnitId) {
        await db.query(
          'UPDATE item_units SET conversion_factor = NULL, units_per_base = NULL WHERE item_id=$1 AND unit_id=$2',
          [itemId, id]
        )
        continue
      }
      const pb = hasPerBase ? cleanPerBase(unitsPerBase[id]) : null
      if (pb !== null) {
        // exact inverse: the factor column keeps a 10-decimal copy for everything that only reads factors
        await db.query(
          'UPDATE item_units SET conversion_factor = $3, units_per_base = $4 WHERE item_id=$1 AND unit_id=$2',
          [itemId, id, roundQty(1 / pb), pb]
        )
      } else if (hasFactors) {
        const f = cleanFactor(unitFactors[id]) // not listed = no override (use the unit's default)
        if (f !== null && !hasPerBase) {
          // An older open browser tab does not know about units_per_base and sends back the factor
          // it was given. If that is the factor we derived from the exact inverse, keep the inverse.
          const { rows } = await db.query(
            'SELECT conversion_factor, units_per_base FROM item_units WHERE item_id=$1 AND unit_id=$2',
            [itemId, id]
          )
          const cur = rows[0]
          if (cur?.units_per_base != null && Math.abs(Number(cur.conversion_factor) - f) < 1e-9) continue
        }
        await db.query(
          'UPDATE item_units SET conversion_factor = $3, units_per_base = NULL WHERE item_id=$1 AND unit_id=$2',
          [itemId, id, f]
        )
      }
    }
  }
}

/**
 * How many base units one `unitId` is worth for this item. Throws 400 if the unit is not
 * enabled for the item. No unit = base quantity as given (factor 1).
 */
export async function resolveUnitFactor(db, itemId, unitId) {
  if (!unitId) return 1
  const { rows } = await db.query(
    `SELECT i.base_unit_id, u.conversion_factor AS default_factor, iu.conversion_factor AS item_factor,
            iu.units_per_base
     FROM items i
     JOIN units u ON u.id = $2
     LEFT JOIN item_units iu ON iu.item_id = i.id AND iu.unit_id = u.id
     WHERE i.id = $1 AND (i.base_unit_id = u.id OR iu.unit_id IS NOT NULL)`,
    [itemId, unitId]
  )
  if (!rows.length) throw new HttpError(400, 'That unit of measurement is not enabled for this item')
  const r = rows[0]
  if (r.base_unit_id === unitId) return 1
  // exact inverse (1 piece = 1/48 pack) when the item has one: never goes through a rounded decimal
  if (r.units_per_base != null && Number(r.units_per_base) > 0) return 1 / Number(r.units_per_base)
  return Number(r.item_factor ?? r.default_factor)
}

/** Reject a unit that is not enabled for the item (a missing unit is allowed, as before). */
export async function assertUnitAllowed(db, itemId, unitId) {
  await resolveUnitFactor(db, itemId, unitId)
}

/**
 * The smallest fraction of its base unit this item is ever counted in (1/48 for a pack-counted
 * item that also issues single pieces), or null when it has no unit smaller than the base unit.
 */
export async function stockGrid(db, itemId) {
  const { rows } = await db.query(
    `SELECT iu.units_per_base, COALESCE(iu.conversion_factor, u.conversion_factor) AS factor
     FROM item_units iu
     JOIN units u ON u.id = iu.unit_id
     JOIN items i ON i.id = iu.item_id
     WHERE iu.item_id = $1 AND iu.unit_id <> COALESCE(i.base_unit_id, '00000000-0000-0000-0000-000000000000')`,
    [itemId]
  )
  let grid = null
  for (const r of rows) {
    const f = r.units_per_base != null && Number(r.units_per_base) > 0 ? 1 / Number(r.units_per_base) : Number(r.factor)
    if (Number.isFinite(f) && f > 0 && f < 1 && (grid === null || f < grid)) grid = f
  }
  return grid
}

/**
 * Snap a balance onto the item's smallest-unit grid when it is within rounding dust of it, so
 * 47 pieces issued one by one from a 6-pack stock end at exactly 5 + 1/48, never 5.0208333329.
 * Values that are genuinely between grid points are left alone.
 */
export function snapToGrid(value, grid) {
  const v = Number(value)
  if (!grid || !Number.isFinite(v)) return roundQty(v)
  const nearest = Math.round(v / grid) * grid
  return roundQty(Math.abs(v - nearest) <= QTY_EPSILON ? nearest : v)
}

/**
 * Add `delta` (base units, negative to remove) to an item's in-store stock. Runs inside the
 * caller's transaction; takes the row lock itself. `clampAtZero` keeps the old GREATEST(0, ...).
 * Returns the new stock.
 */
export async function applyStockDelta(db, itemId, delta, { clampAtZero = false } = {}) {
  const { rows } = await db.query('SELECT quantity FROM items WHERE id = $1 FOR UPDATE', [itemId])
  if (!rows.length) throw new HttpError(404, 'Item not found')
  let next = Number(rows[0].quantity) + Number(delta)
  if (clampAtZero && next < 0) next = 0
  next = snapToGrid(next, await stockGrid(db, itemId))
  await db.query('UPDATE items SET quantity = $1, updated_at = NOW() WHERE id = $2', [next, itemId])
  return next
}
