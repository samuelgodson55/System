import { Router } from 'express'
import { query, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { uuidParam } from '../middleware/validate.js'

const router = Router()
router.use(authenticate)
router.param('id', uuidParam)

function mapUnit(r) {
  return {
    id: r.id,
    name: r.name,
    abbreviation: r.abbreviation,
    conversionFactor: Number(r.conversion_factor),
    isBase: r.is_base,
  }
}

router.get('/', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM units ORDER BY is_base DESC, name')
    res.json(rows.map(mapUnit))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch units' })
  }
})

function validateUnit(b) {
  if (!String(b.name || '').trim() || !String(b.abbreviation || '').trim()) return 'Name and abbreviation are required'
  const f = Number(b.conversionFactor ?? 1)
  if (!Number.isFinite(f) || f <= 0) return 'Conversion factor must be greater than 0'
  // stored as NUMERIC(12,4): anything below 0.0001 would round to 0, above 99,999,999 overflows
  if (f < 0.0001) return 'Conversion factor must be at least 0.0001'
  if (f > 99999999) return 'Conversion factor is too large'
  if (String(b.name).trim().length > 80) return 'Name must be 80 characters or fewer'
  if (String(b.abbreviation).trim().length > 20) return 'Abbreviation must be 20 characters or fewer'
  return null
}

/** A second unit with the same name or abbreviation (any capitalisation) would be impossible to tell apart in the pick-lists. */
async function duplicateOf(db, name, abbreviation, exceptId = null) {
  const { rows } = await db(
    `SELECT name, abbreviation FROM units
     WHERE (lower(btrim(name)) = lower($1) OR lower(btrim(abbreviation)) = lower($2))
       AND ($3::uuid IS NULL OR id <> $3)
     LIMIT 1`,
    [name.trim(), abbreviation.trim(), exceptId]
  )
  return rows[0] || null
}
const duplicateMessage = (d) => `There is already a unit called "${d.name}" (${d.abbreviation}). Use a different name and abbreviation.`

router.post('/', requireAdmin, async (req, res) => {
  try {
    const invalid = validateUnit(req.body)
    if (invalid) return res.status(400).json({ error: invalid })
    const { name, abbreviation, conversionFactor, isBase } = req.body
    const dup = await duplicateOf(query, name, abbreviation)
    if (dup) return res.status(409).json({ error: duplicateMessage(dup) })
    if (isBase) {
      const existing = await query('SELECT name FROM units WHERE is_base LIMIT 1')
      if (existing.rows.length) {
        return res.status(409).json({
          error: `There is already a base unit (${existing.rows[0].name}). Every quantity is stored in it, so there can only be one.`,
        })
      }
    }
    const { rows } = await query(
      `INSERT INTO units (name, abbreviation, conversion_factor, is_base)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), abbreviation.trim(), isBase ? 1 : Number(conversionFactor ?? 1), !!isBase]
    )
    res.status(201).json(mapUnit(rows[0]))
  } catch (e) {
    // two admins adding a base unit at the same moment: the unique index lets only one through
    if (e.code === '23505') return res.status(409).json({ error: 'There is already a base unit, and there can only be one.' })
    console.error(e)
    res.status(500).json({ error: 'Failed to create unit' })
  }
})

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const invalid = validateUnit(req.body)
    if (invalid) return res.status(400).json({ error: invalid })
    const { name, abbreviation, conversionFactor, isBase } = req.body
    const result = await withTransaction(async (client) => {
      const cur = await client.query('SELECT * FROM units WHERE id=$1 FOR UPDATE', [req.params.id])
      if (!cur.rows.length) return { status: 404, error: 'Unit not found' }
      const unit = cur.rows[0]
      if (unit.is_base && !isBase) {
        return { status: 409, error: 'This is the base unit – every quantity is stored in it, so it cannot be turned into a normal unit.' }
      }
      if (!unit.is_base && isBase) {
        return { status: 409, error: 'There is already a base unit, and there can only be one.' }
      }
      // a body without a factor keeps the current one (Number(undefined) would be NaN and a 500)
      const factor = isBase ? 1 : conversionFactor === undefined ? Number(unit.conversion_factor) : Number(conversionFactor)
      const renamed =
        name.trim().toLowerCase() !== String(unit.name).trim().toLowerCase() ||
        abbreviation.trim().toLowerCase() !== String(unit.abbreviation).trim().toLowerCase()
      if (renamed) {
        const dup = await duplicateOf((text, params) => client.query(text, params), name, abbreviation, unit.id)
        if (dup) return { status: 409, error: duplicateMessage(dup) }
      }
      // Changing what a unit is worth would make past entries ("5 cartons") disagree with the
      // stock they added, so it is only allowed while the unit has never been used.
      if (Number(unit.conversion_factor) !== factor) {
        const used = await client.query('SELECT 1 FROM transactions WHERE unit_id=$1 LIMIT 1', [unit.id])
        if (used.rows.length) {
          return {
            status: 409,
            error: 'This unit is already used in stock history, so its conversion factor can no longer change. Create a new unit, or set a different factor for a single item when editing that item.',
          }
        }
      }
      const { rows } = await client.query(
        `UPDATE units SET name=$1, abbreviation=$2, conversion_factor=$3, is_base=$4
         WHERE id=$5 RETURNING *`,
        [name.trim(), abbreviation.trim(), factor, !!isBase, req.params.id]
      )
      return { status: 200, body: mapUnit(rows[0]) }
    })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result.body)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to update unit' })
  }
})

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT is_base FROM units WHERE id=$1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })
    if (rows[0].is_base) return res.status(400).json({ error: 'Cannot delete base unit' })
    await query('DELETE FROM units WHERE id=$1', [req.params.id])
    res.status(204).end()
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'This unit is used by items or transactions and cannot be deleted' })
    }
    console.error(e)
    res.status(500).json({ error: 'Failed to delete unit' })
  }
})

export default router
