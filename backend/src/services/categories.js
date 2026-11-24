/**
 * Editable categories.
 *
 * items.category stays plain text (every query, export and SKU rule keeps using it); the
 * `categories` table is the managed list on top of it, so a category can be renamed, merged
 * into another one, or removed when nothing uses it.
 *
 * Case/spacing is ignored when comparing ("cleaning " = "Cleaning"). Every writer takes the same
 * advisory lock FIRST (before any row locks) so concurrent edits can never deadlock or create
 * duplicates.
 */
import { pool } from '../db/pool.js'
import { HttpError } from './kits.js'

const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('categories_write'))"

export const normCategory = (v) => String(v ?? '').trim().replace(/\s+/g, ' ')

function checkName(name) {
  if (!name) throw new HttpError(400, 'Category name is required')
  if (name.length > 100) throw new HttpError(400, 'Category must be 100 characters or fewer')
}

/** Add any category used by an item but missing from the list (also repairs a restored backup). */
export async function syncCategoriesFromItems() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(LOCK_SQL)
    await client.query(
      `INSERT INTO categories (name)
       SELECT DISTINCT ON (lower(btrim(i.category))) left(btrim(i.category), 100)
       FROM items i
       WHERE i.category IS NOT NULL AND btrim(i.category) <> ''
         AND NOT EXISTS (SELECT 1 FROM categories c WHERE lower(c.name) = lower(btrim(i.category)))
       ORDER BY lower(btrim(i.category)), btrim(i.category)
       ON CONFLICT DO NOTHING`
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Categories with how many items use each, A–Z. */
export async function listCategories(db = pool) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, COALESCE(u.n, 0)::int AS item_count
     FROM categories c
     LEFT JOIN (
       SELECT lower(btrim(category)) AS k, COUNT(*) AS n FROM items GROUP BY 1
     ) u ON u.k = lower(c.name)
     ORDER BY lower(c.name), c.name`
  )
  return rows.map((r) => ({ id: r.id, name: r.name, itemCount: r.item_count }))
}

/**
 * The category's canonical spelling for saving on an item, creating it if it is new.
 * Call inside the caller's transaction, before locking any item row.
 */
export async function ensureCategory(client, raw) {
  const name = normCategory(raw)
  if (!name) return name
  checkName(name)
  await client.query(LOCK_SQL)
  const hit = await client.query('SELECT name FROM categories WHERE lower(name) = lower($1)', [name])
  if (hit.rows[0]) return hit.rows[0].name
  // not listed yet: prefer the spelling items already use, otherwise the typed one
  const used = await client.query(
    `SELECT btrim(category) AS category FROM items
     WHERE lower(btrim(category)) = lower($1)
     GROUP BY btrim(category) ORDER BY COUNT(*) DESC LIMIT 1`,
    [name]
  )
  const spelling = used.rows[0]?.category || name
  await client.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING', [spelling])
  return spelling
}

/** Create a category on its own (no item yet). Returns { created, category }. */
export async function createCategory(client, raw) {
  const name = normCategory(raw)
  checkName(name)
  await client.query(LOCK_SQL)
  const hit = await client.query('SELECT id, name FROM categories WHERE lower(name) = lower($1)', [name])
  if (hit.rows[0]) return { created: false, category: hit.rows[0] }
  const { rows } = await client.query('INSERT INTO categories (name) VALUES ($1) RETURNING id, name', [name])
  return { created: true, category: rows[0] }
}

/**
 * Rename a category: the list entry and every item that uses it change together (one
 * transaction). If the new name is already another category, the caller must pass merge=true;
 * the items then move into that category and this entry disappears.
 * Quantities, SKUs and the ledger are never touched.
 */
export async function renameCategory(client, id, rawName, { merge = false } = {}) {
  const name = normCategory(rawName)
  checkName(name)
  await client.query(LOCK_SQL)
  const cur = await client.query('SELECT id, name FROM categories WHERE id = $1 FOR UPDATE', [id])
  if (!cur.rows[0]) throw new HttpError(404, 'Category not found')
  const old = cur.rows[0].name

  const clash = await client.query(
    'SELECT id, name FROM categories WHERE lower(name) = lower($1) AND id <> $2',
    [name, id]
  )
  let final = name
  let merged = false
  if (clash.rows[0]) {
    if (!merge) {
      const err = new HttpError(409, `“${clash.rows[0].name}” already exists`)
      err.extra = { code: 'CATEGORY_EXISTS', existing: clash.rows[0] }
      throw err
    }
    final = clash.rows[0].name
    merged = true
  }

  // updated_at is left alone on purpose: a rename is not a stock change
  const moved = await client.query(
    `UPDATE items SET category = $1
     WHERE lower(btrim(category)) = lower($2) AND category IS DISTINCT FROM $1`,
    [final, old]
  )
  if (merged) {
    await client.query('DELETE FROM categories WHERE id = $1', [id])
    return { id: clash.rows[0].id, name: final, merged: true, itemsUpdated: moved.rowCount }
  }
  await client.query('UPDATE categories SET name = $1, updated_at = NOW() WHERE id = $2', [final, id])
  return { id, name: final, merged: false, itemsUpdated: moved.rowCount }
}

/** Remove a category from the list. Refused while any item still uses it. */
export async function deleteCategory(client, id) {
  await client.query(LOCK_SQL)
  const cur = await client.query('SELECT id, name FROM categories WHERE id = $1 FOR UPDATE', [id])
  if (!cur.rows[0]) throw new HttpError(404, 'Category not found')
  const used = await client.query(
    'SELECT COUNT(*)::int AS n FROM items WHERE lower(btrim(category)) = lower($1)',
    [cur.rows[0].name]
  )
  if (used.rows[0].n > 0) {
    throw new HttpError(
      409,
      `${used.rows[0].n} item(s) still use “${cur.rows[0].name}”. Rename it, or move those items to another category first.`
    )
  }
  await client.query('DELETE FROM categories WHERE id = $1', [id])
}
