import { Router } from 'express'
import { withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { uuidParam } from '../middleware/validate.js'
import { HttpError } from '../services/kits.js'
import {
  syncRecipientsFromLedger, listRecipients, updateRecipient, recipientLedgerDepartments, listDepartmentConflicts,
} from '../services/recipients.js'

const router = Router()
router.use(authenticate)
router.param('id', uuidParam)

function fail(res, e, fallback) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) })
  console.error(e)
  return res.status(500).json({ error: fallback })
}

/** GET /api/recipients?search= → [{ id, name, department }]  (A–Z) */
router.get('/', async (req, res) => {
  try {
    await syncRecipientsFromLedger()
    res.json(await listRecipients({ search: req.query.search, limit: req.query.limit }))
  } catch (e) {
    fail(res, e, 'Failed to load recipients')
  }
})

/** GET /api/recipients/conflicts → people whose records sit under more than one department */
router.get('/conflicts', async (_req, res) => {
  try {
    await syncRecipientsFromLedger()
    res.json(await listDepartmentConflicts())
  } catch (e) {
    fail(res, e, 'Failed to check recipients')
  }
})

/** GET /api/recipients/:id/usage → which departments this person's records are filed under */
router.get('/:id/usage', async (req, res) => {
  try {
    res.json(await recipientLedgerDepartments(req.params.id))
  } catch (e) {
    fail(res, e, 'Failed to load recipient records')
  }
})

/**
 * PUT /api/recipients/:id { name?, department?, applyToHistory?, merge? }   (admin only: it can rewrite past records)
 * A changed department is also applied to the person's past records unless applyToHistory=false.
 * New recipients are added automatically when stock is issued to them, so there is no POST.
 */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await withTransaction((c) => updateRecipient(c, req.params.id, req.body || {}, req.user?.name || 'Unknown')))
  } catch (e) {
    fail(res, e, 'Failed to update recipient')
  }
})

export default router
