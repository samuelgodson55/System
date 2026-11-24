/**
 * Reusable recipients (the people stock is issued to).
 *
 * Every ledger line keeps the recipient and department as TEXT, exactly as before, so
 * outstanding balances, returns, exports and reports keep working untouched. The `recipients`
 * table is the pick-list on top of it:
 *   - issuing to a new name adds it to the list (inside the same transaction as the issue);
 *   - issuing to an existing name (any capitalisation) re-uses the saved spelling;
 *   - renaming a recipient also renames them on their past ledger lines, so their outstanding
 *     balances stay together under the corrected name.
 * `department` on a recipient is the person's ONE department: every new issue to a saved
 * recipient is recorded under it (a typed, different department is ignored), so one person can
 * no longer end up with two stock histories. To move someone, or to repair history that was
 * recorded under a wrong department, edit the recipient (see updateRecipient).
 *
 * Every writer takes the same advisory lock FIRST, before any item/ledger row locks.
 */
import { pool } from '../db/pool.js'
import { HttpError } from './kits.js'

const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('recipients_write'))"
const SYNC_EVERY_MS = 5 * 60 * 1000

export const normName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ')

let lastSync = 0
/** Call after a backup restore so the list is rebuilt from the restored ledger. */
export function markRecipientsStale() {
  lastSync = 0
}

/** Add every ledger recipient that is missing from the list (first run, restored backups, seed data). */
export async function syncRecipientsFromLedger({ force = false } = {}) {
  if (!force && Date.now() - lastSync < SYNC_EVERY_MS) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(LOCK_SQL)
    await client.query(
      `INSERT INTO recipients (name, department)
       SELECT DISTINCT ON (lower(btrim(t.recipient)))
              left(btrim(t.recipient), 200), left(NULLIF(btrim(COALESCE(t.department, '')), ''), 120)
       FROM transactions t
       WHERE t.type = 'issue' AND t.recipient IS NOT NULL AND btrim(t.recipient) <> ''
         AND NOT EXISTS (SELECT 1 FROM recipients r WHERE lower(r.name) = lower(btrim(t.recipient)))
       ORDER BY lower(btrim(t.recipient)), t.created_at DESC
       ON CONFLICT DO NOTHING`
    )
    await client.query('COMMIT')
    lastSync = Date.now()
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

const mapRecipient = (r) => ({
  id: r.id,
  name: r.name,
  department: r.department || '',
  createdAt: r.created_at,
})

export async function listRecipients({ search = '', limit = 5000 } = {}) {
  const params = []
  let where = ''
  const q = normName(search)
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`)
    where = 'WHERE name ILIKE $1 OR department ILIKE $1'
  }
  params.push(Math.min(5000, Math.max(1, Number(limit) || 5000)))
  const { rows } = await pool.query(
    `SELECT * FROM recipients ${where} ORDER BY lower(name), name LIMIT $${params.length}`,
    params
  )
  return rows.map(mapRecipient)
}

/**
 * Use on every issue. Returns the recipient's saved spelling (creating the recipient if new) and
 * the department to record. Call inside the caller's transaction BEFORE locking any item row.
 */
export async function ensureRecipient(client, rawName, rawDepartment) {
  const name = normName(rawName)
  let department = normName(rawDepartment) || undefined
  if (!name) return { name: undefined, department }
  if (name.length > 200) throw new HttpError(400, 'Recipient name must be 200 characters or fewer')
  if (department && department.length > 120) throw new HttpError(400, 'Department must be 120 characters or fewer')
  await client.query(LOCK_SQL)
  // re-use the saved spelling of a department (any capitalisation) so "plumbing" and "Plumbing" never split
  if (department) {
    const d = await client.query(
      'SELECT department FROM recipients WHERE lower(department) = lower($1) ORDER BY updated_at DESC LIMIT 1',
      [department]
    )
    if (d.rows[0]) department = d.rows[0].department
  }
  const hit = await client.query('SELECT id, name, department FROM recipients WHERE lower(name) = lower($1)', [name])
  if (hit.rows[0]) {
    const r = hit.rows[0]
    if (r.department) {
      // the saved department is authoritative: one person, one department
      return { name: r.name, department: r.department }
    }
    if (department) {
      await client.query('UPDATE recipients SET department = $1, updated_at = NOW() WHERE id = $2', [department, r.id])
    }
    return { name: r.name, department }
  }
  await client.query('INSERT INTO recipients (name, department) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    name,
    department || null,
  ])
  return { name, department }
}

/**
 * Edit a recipient's name and/or default department.
 * A new name also replaces the old one on past ledger lines. If the new name is already
 * another recipient, merge=true is required: their records are then combined under that name.
 *
 * A new department is applied to the person's past ledger lines too (applyToHistory, default
 * true), so everything they hold stays together under ONE department. Pass
 * applyToHistory=false only to change the department offered from now on.
 * Quantities, dates, items and stock levels are never touched - only the department/name text.
 */
export async function updateRecipient(client, id, body = {}, actor = 'Unknown') {
  await client.query(LOCK_SQL)
  const cur = await client.query('SELECT * FROM recipients WHERE id = $1 FOR UPDATE', [id])
  if (!cur.rows[0]) throw new HttpError(404, 'Recipient not found')
  const row = cur.rows[0]

  const name = body.name === undefined ? row.name : normName(body.name)
  if (!name) throw new HttpError(400, 'Recipient name is required')
  if (name.length > 200) throw new HttpError(400, 'Recipient name must be 200 characters or fewer')
  let department = body.department === undefined ? row.department : normName(body.department) || null
  if (department && department.length > 120) throw new HttpError(400, 'Department must be 120 characters or fewer')

  if (department && department !== row.department) {
    const d = await client.query(
      'SELECT department FROM recipients WHERE lower(department) = lower($1) AND id <> $2 ORDER BY updated_at DESC LIMIT 1',
      [department, id]
    )
    if (d.rows[0]) department = d.rows[0].department
  }
  const applyToHistory = body.applyToHistory !== false

  const clash = await client.query(
    'SELECT * FROM recipients WHERE lower(name) = lower($1) AND id <> $2 FOR UPDATE',
    [name, id]
  )
  let final = name
  let target = null
  if (clash.rows[0]) {
    if (!body.merge) {
      const err = new HttpError(409, `“${clash.rows[0].name}” is already on the recipient list`)
      err.extra = { code: 'RECIPIENT_EXISTS', existing: mapRecipient(clash.rows[0]) }
      throw err
    }
    target = clash.rows[0]
    final = target.name
  }

  // past ledger lines (any spelling/capitalisation of the old name) move to the final name
  const moved = await client.query(
    `UPDATE transactions SET recipient = $1
     WHERE lower(btrim(recipient)) = lower($2) AND recipient IS DISTINCT FROM $1`,
    [final, row.name]
  )

  if (target) {
    await client.query('DELETE FROM recipients WHERE id = $1', [id])
    if (!target.department && department) {
      await client.query('UPDATE recipients SET department = $1, updated_at = NOW() WHERE id = $2', [department, target.id])
      target.department = department
    }
    // a merged person has one department: the one the surviving record holds
    const mergedDept = target.department || null
    const unified = applyToHistory && mergedDept
      ? await setLedgerDepartment(client, final, mergedDept)
      : 0
    await audit(client, {
      recipient: target, action: 'merge', oldName: row.name, oldDepartment: row.department,
      newDepartment: mergedDept, lines: moved.rowCount + unified, actor,
    })
    return { recipient: mapRecipient(target), merged: true, ledgerLinesUpdated: moved.rowCount + unified }
  }
  const { rows } = await client.query(
    'UPDATE recipients SET name = $1, department = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
    [final, department, id]
  )
  const deptChanged = (row.department || null) !== (department || null)
  let departmentLines = 0
  if (department && applyToHistory) departmentLines = await setLedgerDepartment(client, final, department)
  if (deptChanged || final !== row.name || departmentLines > 0) {
    await audit(client, {
      recipient: rows[0], action: deptChanged || departmentLines > 0 ? 'department' : 'rename', oldName: final !== row.name ? row.name : null,
      oldDepartment: row.department, newDepartment: department,
      lines: moved.rowCount + departmentLines, actor,
    })
  }
  return {
    recipient: mapRecipient(rows[0]),
    merged: false,
    ledgerLinesUpdated: moved.rowCount + departmentLines,
    departmentLinesUpdated: departmentLines,
  }
}

/** Put every ledger line of a person under one department. Text only: no quantity or stock changes. */
async function setLedgerDepartment(client, recipientName, department) {
  const r = await client.query(
    `UPDATE transactions SET department = $2
     WHERE lower(btrim(recipient)) = lower($1) AND department IS DISTINCT FROM $2`,
    [recipientName, department]
  )
  return r.rowCount
}

async function audit(client, { recipient, action, oldName, oldDepartment, newDepartment, lines, actor }) {
  await client.query(
    `INSERT INTO recipient_audit
       (recipient_id, recipient_name, action, old_department, new_department, old_name, ledger_lines_updated, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [recipient.id, recipient.name, action, oldDepartment || null, newDepartment || null, oldName || null, lines, actor]
  )
}

/**
 * The departments a person's ledger lines are recorded under (with line counts and what is still
 * out). More than one = their history is split. Used by the edit dialog and the "needs fixing" list.
 */
export async function recipientLedgerDepartments(id) {
  const cur = await pool.query('SELECT * FROM recipients WHERE id = $1', [id])
  if (!cur.rows[0]) throw new HttpError(404, 'Recipient not found')
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(btrim(department), ''), '') AS department, COUNT(*)::int AS lines,
            MAX(created_at) AS last_activity
     FROM transactions
     WHERE lower(btrim(recipient)) = lower($1)
     GROUP BY COALESCE(NULLIF(btrim(department), ''), '')
     ORDER BY MAX(created_at) DESC`,
    [cur.rows[0].name]
  )
  return {
    recipient: mapRecipient(cur.rows[0]),
    departments: rows.map((r) => ({ department: r.department, lines: r.lines, lastActivity: r.last_activity })),
    split: rows.length > 1 || (rows.length === 1 && (rows[0].department || '') !== (cur.rows[0].department || '')),
  }
}

/** Everyone whose ledger does not match their saved department (the people to repair). */
export async function listDepartmentConflicts() {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.department,
            array_agg(DISTINCT COALESCE(NULLIF(btrim(t.department), ''), '(none)')) AS ledger_departments
     FROM recipients r
     JOIN transactions t ON lower(btrim(t.recipient)) = lower(r.name)
     GROUP BY r.id, r.name, r.department
     HAVING COUNT(DISTINCT COALESCE(NULLIF(btrim(t.department), ''), '')) > 1
         OR (r.department IS NOT NULL
             AND bool_or(COALESCE(NULLIF(btrim(t.department), ''), '') <> r.department))
     ORDER BY lower(r.name)`
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    department: r.department || '',
    ledgerDepartments: r.ledger_departments,
  }))
}
