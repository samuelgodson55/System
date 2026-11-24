import { Router } from 'express'
import { pool, withTransaction } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { uuidParam } from '../middleware/validate.js'
import { HttpError } from '../services/kits.js'
import {
  syncCategoriesFromItems, listCategories, createCategory, renameCategory, deleteCategory,
} from '../services/categories.js'

const router = Router()
router.use(authenticate)
router.param('id', uuidParam)

function fail(res, e, fallback) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) })
  console.error(e)
  return res.status(500).json({ error: fallback })
}

/** GET /api/categories → [{ id, name, itemCount }] */
router.get('/', async (_req, res) => {
  try {
    await syncCategoriesFromItems()
    res.json(await listCategories(pool))
  } catch (e) {
    fail(res, e, 'Failed to load categories')
  }
})

/** POST /api/categories { name } – add a category without an item. Re-posting an existing name is harmless. */
router.post('/', async (req, res) => {
  try {
    const { created, category } = await withTransaction((c) => createCategory(c, req.body?.name))
    res.status(created ? 201 : 200).json({ ...category, itemCount: 0, created })
  } catch (e) {
    fail(res, e, 'Failed to create category')
  }
})

/** PUT /api/categories/:id { name, merge? } (admin only) – rename (items follow); merge=true to fold into an existing one. */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const out = await withTransaction((c) =>
      renameCategory(c, req.params.id, req.body?.name, { merge: req.body?.merge === true })
    )
    res.json(out)
  } catch (e) {
    fail(res, e, 'Failed to rename category')
  }
})

/** DELETE /api/categories/:id (admin only) – only when no item uses it. */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await withTransaction((c) => deleteCategory(c, req.params.id))
    res.status(204).end()
  } catch (e) {
    fail(res, e, 'Failed to delete category')
  }
})

export default router
