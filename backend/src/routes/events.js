import { Router } from 'express'
import { query } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { uuidParam, isCalendarDate, cleanLine, clean } from '../middleware/validate.js'
import { mapTxn } from '../services/mappers.js'

const router = Router()
router.use(authenticate)
router.param('id', uuidParam)

const STATUSES = ['upcoming', 'active', 'completed']

function mapEvent(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    location: r.location,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    txnCount: Number(r.txn_count || 0),
  }
}

/**
 * Validate an event body. Returns { error } or { value }. A missing description/location/status is
 * "unchanged-or-default" rather than NULL (status is NOT NULL, so a partial update used to be a 500).
 */
function readBody(b = {}, current = null) {
  const name = cleanLine(b.name)
  if (!name) return { error: 'Event name is required' }
  if (name.length > 200) return { error: 'Event name must be 200 characters or fewer' }
  const location = b.location === undefined ? current?.location ?? '' : cleanLine(b.location) || ''
  if (location.length > 200) return { error: 'Location must be 200 characters or fewer' }
  const description = b.description === undefined ? current?.description ?? '' : clean(b.description) || ''
  const status = b.status === undefined || b.status === '' ? current?.status ?? 'upcoming' : b.status
  if (!STATUSES.includes(status)) return { error: `Status must be one of: ${STATUSES.join(', ')}` }
  const startDate = b.startDate ? String(b.startDate).slice(0, 10) : null
  const endDate = b.endDate ? String(b.endDate).slice(0, 10) : null
  if (startDate && !isCalendarDate(startDate)) return { error: 'Start date is not a valid date' }
  if (endDate && !isCalendarDate(endDate)) return { error: 'End date is not a valid date' }
  if (startDate && endDate && endDate < startDate) return { error: 'The end date cannot be before the start date' }
  return { value: { name, description, location, status, startDate, endDate } }
}

router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(`SELECT e.*, (SELECT COUNT(*) FROM transactions t WHERE t.event_id = e.id) AS txn_count
       FROM events e ORDER BY e.start_date DESC NULLS LAST, e.name`)
    res.json(rows.map(mapEvent))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch events' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Event not found' })
    res.json(mapEvent(rows[0]))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch event' })
  }
})

router.get('/:id/transactions', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.*, kc.name AS component_name
       FROM transactions t LEFT JOIN kit_components kc ON kc.id = t.component_id
       WHERE t.event_id=$1 ORDER BY t.created_at DESC LIMIT 5000`,
      [req.params.id]
    )
    res.json(rows.map(mapTxn))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch event transactions' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { error, value: v } = readBody(req.body)
    if (error) return res.status(400).json({ error })
    const { rows } = await query(
      `INSERT INTO events (name, description, location, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [v.name, v.description, v.location, v.startDate, v.endDate, v.status]
    )
    res.status(201).json(mapEvent(rows[0]))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to create event' })
  }
})

// Staff can create events and book stock against them; changing or removing one is an admin task.
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const cur = await query('SELECT * FROM events WHERE id=$1', [req.params.id])
    if (!cur.rows.length) return res.status(404).json({ error: 'Event not found' })
    const { error, value: v } = readBody(req.body, cur.rows[0])
    if (error) return res.status(400).json({ error })
    const { rows } = await query(
      `UPDATE events SET name=$1, description=$2, location=$3, start_date=$4, end_date=$5, status=$6
       WHERE id=$7 RETURNING *`,
      [v.name, v.description, v.location, v.startDate, v.endDate, v.status, req.params.id]
    )
    res.json(mapEvent(rows[0]))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to update event' })
  }
})

// Stock lines keep their link to the event they were issued for. Deleting an event that has any
// would silently detach them (source stays "event", the event becomes blank) and the history of what
// that event used would be gone for good, so it is refused: mark the event "completed" instead.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    // one statement: the event is only removed if nothing is booked against it
    const del = await query(
      `DELETE FROM events e
       WHERE e.id = $1 AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.event_id = e.id)
       RETURNING e.id`,
      [req.params.id]
    )
    if (del.rowCount) return res.status(204).end()
    const still = await query(
      'SELECT (SELECT COUNT(*)::int FROM transactions WHERE event_id = $1) AS n FROM events WHERE id = $1',
      [req.params.id]
    )
    if (!still.rows.length) return res.status(404).json({ error: 'Event not found' })
    return res.status(409).json({
      error: `This event has ${still.rows[0].n} stock transaction(s) recorded against it, so it can't be deleted without losing that history. Set its status to "Completed" instead.`,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to delete event' })
  }
})

export default router
