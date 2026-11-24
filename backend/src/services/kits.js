/**
 * Kit / tool-set accounting.
 *
 * Model
 * -----
 *  - A kit is an `items` row with item_type = 'kit'. Its `quantity` is the number of
 *    COMPLETE sets on the shelf.
 *  - kit_components lists what is in one set (name + quantity_per_kit). Each component
 *    also has `loose_quantity`: pieces that are in store but not inside a complete set
 *    (left over after a piece was issued from a set, or returned on its own).
 *  - In-store stock of a component  = kit.quantity * quantity_per_kit + loose_quantity.
 *  - Issuing the whole kit takes N complete sets and logs one kit line plus one line per
 *    component (parent_txn_id links them) so every piece can be traced.
 *  - Issuing individual pieces first uses loose pieces; if more are needed a complete set
 *    is "opened" (kit.quantity -1, its pieces become loose) – exactly what happens on the
 *    shelf – and the requested pieces leave.
 *  - Returns work per piece. If every piece of N sets is back they snap into complete
 *    sets; otherwise they go to the loose pool and what is missing stays outstanding
 *    against the recipient.
 *  - Loose pieces snap back into complete sets automatically after a return or a received
 *    replacement as soon as a full set's worth exists (autoRepack); the manual repack
 *    endpoint remains for anything already sitting loose.
 *
 * Every function expects to run inside withTransaction().
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const bad = (msg) => new HttpError(400, msg)

export function positiveInt(v, label) {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw bad(`${label} must be a whole number greater than 0`)
  return n
}

function nonNegInt(v, label) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw bad(`${label} must be a whole number (0 or more)`)
  return n
}

/** Lock the kit row and its active components (stable order avoids deadlocks). */
export async function lockKit(client, itemId) {
  const itemRes = await client.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [itemId])
  if (!itemRes.rows.length) throw new HttpError(404, 'Item not found')
  const item = itemRes.rows[0]
  if (item.item_type !== 'kit') throw bad('This item is not a kit')
  const compRes = await client.query(
    `SELECT * FROM kit_components WHERE kit_id = $1 AND is_active
     ORDER BY position, name FOR UPDATE`,
    [itemId]
  )
  if (!compRes.rows.length) throw bad('This kit has no components defined')
  return { item, comps: compRes.rows }
}

export async function activeComponentCount(client, itemId) {
  const { rows } = await client.query(
    'SELECT COUNT(*)::int AS n FROM kit_components WHERE kit_id = $1 AND is_active',
    [itemId]
  )
  return rows[0].n
}

async function insertTxn(client, t) {
  const { rows } = await client.query(
    `INSERT INTO transactions
     (item_id, type, quantity, unit_id, unit_quantity, source, event_id, vendor,
      recipient, department, notes, performed_by, component_id, parent_txn_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      t.itemId, t.type, t.quantity, t.unitId || null, t.unitQuantity ?? t.quantity,
      t.source || null, t.eventId || null, t.vendor || null,
      t.recipient || null, t.department || null, t.notes || null,
      t.performedBy || 'Unknown', t.componentId || null, t.parentId || null,
    ]
  )
  return rows[0]
}

function requireRecipient(p) {
  if (!String(p.recipient || '').trim()) throw bad('Recipient is required')
  if (p.source === 'event' && !p.eventId) throw bad('Select the event')
}

/** Merge duplicate lines and validate each against the kit's components. */
function normaliseLines(lines, byId, { allowZero = false } = {}) {
  const merged = new Map()
  for (const l of lines || []) {
    const comp = byId.get(l.componentId)
    if (!comp) throw bad('A selected piece does not belong to this kit')
    const q = allowZero ? nonNegInt(l.quantity, `Quantity for ${comp.name}`)
                        : positiveInt(l.quantity, `Quantity for ${comp.name}`)
    merged.set(comp.id, (merged.get(comp.id) || 0) + q)
  }
  return merged
}

const outstandingKey = (itemId, recipient, department) => [itemId, recipient, department || '']

async function componentOutstanding(client, itemId, recipient, department) {
  const { rows } = await client.query(
    `SELECT component_id,
            COALESCE(SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN type='return' THEN quantity ELSE 0 END),0) AS bal
     FROM transactions
     WHERE item_id=$1 AND component_id IS NOT NULL AND recipient=$2
       AND COALESCE(department,'')=$3
     GROUP BY component_id`,
    outstandingKey(itemId, recipient, department)
  )
  return new Map(rows.map((r) => [r.component_id, Number(r.bal)]))
}

async function setsOutstanding(client, itemId, recipient, department) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN type='return' THEN quantity ELSE 0 END),0) AS bal
     FROM transactions
     WHERE item_id=$1 AND component_id IS NULL AND recipient=$2
       AND COALESCE(department,'')=$3`,
    outstandingKey(itemId, recipient, department)
  )
  return Number(rows[0].bal)
}

async function setLoose(client, compId, loose) {
  await client.query('UPDATE kit_components SET loose_quantity=$1 WHERE id=$2', [loose, compId])
  // Loose pieces are part of the kit's stock, so the kit counts as changed: screens that watch
  // `updatedAt` (item history, caches) then know to reload. Previously only set changes did this.
  await client.query(
    'UPDATE items SET updated_at = NOW() WHERE id = (SELECT kit_id FROM kit_components WHERE id = $1)',
    [compId]
  )
}

async function setSets(client, itemId, delta) {
  await client.query(
    'UPDATE items SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2',
    [delta, itemId]
  )
}

/* ------------------------------------------------------------------ issue */

/** Issue N complete sets: kit line + a line for every component. */
export async function issueWholeKit(client, p) {
  requireRecipient(p)
  const sets = positiveInt(p.sets, 'Number of sets')
  const { item, comps } = await lockKit(client, p.itemId)
  if (sets > Number(item.quantity)) {
    throw bad(`Insufficient complete sets. Available: ${Number(item.quantity)}`)
  }
  await setSets(client, item.id, -sets)

  const common = {
    itemId: item.id, type: 'issue', source: p.source, eventId: p.eventId,
    recipient: p.recipient, department: p.department, performedBy: p.performedBy,
  }
  const parent = await insertTxn(client, {
    ...common, quantity: sets, unitId: p.unitId, unitQuantity: sets, notes: p.notes,
  })
  const children = []
  for (const c of comps) {
    children.push(await insertTxn(client, {
      ...common, quantity: sets * c.quantity_per_kit, componentId: c.id, parentId: parent.id,
    }))
  }
  return { parent, children, setsOpened: 0 }
}

/** Issue individual pieces. Opens complete sets only when loose pieces run out. */
export async function issuePieces(client, p) {
  requireRecipient(p)
  const { item, comps } = await lockKit(client, p.itemId)
  const byId = new Map(comps.map((c) => [c.id, c]))
  const wanted = normaliseLines(p.lines, byId)
  if (!wanted.size) throw bad('Select at least one piece to issue')

  const sets = Number(item.quantity)
  let toOpen = 0
  for (const [id, k] of wanted) {
    const c = byId.get(id)
    const inStore = sets * c.quantity_per_kit + c.loose_quantity
    if (k > inStore) throw bad(`Not enough "${c.name}" in store (${inStore} available)`)
    const short = k - c.loose_quantity
    if (short > 0) toOpen = Math.max(toOpen, Math.ceil(short / c.quantity_per_kit))
  }

  if (toOpen > 0) await setSets(client, item.id, -toOpen)
  for (const c of comps) {
    const loose = c.loose_quantity + toOpen * c.quantity_per_kit - (wanted.get(c.id) || 0)
    if (loose !== c.loose_quantity) await setLoose(client, c.id, loose)
  }

  const txns = []
  for (const [id, k] of wanted) {
    txns.push(await insertTxn(client, {
      itemId: item.id, type: 'issue', quantity: k, componentId: id,
      source: p.source, eventId: p.eventId, recipient: p.recipient,
      department: p.department, notes: p.notes, performedBy: p.performedBy,
    }))
  }
  return { transactions: txns, setsOpened: toOpen }
}

/* ----------------------------------------------------------------- return */

/**
 * Return a kit and/or loose pieces from one recipient.
 * `sets` = complete sets being handed back (0 for pieces only);
 * `lines` = pieces actually received (defaults to the full contents of `sets`).
 */
export async function returnKit(client, p) {
  if (!String(p.recipient || '').trim()) throw bad('Recipient is required for returns')
  const sets = p.sets === undefined || p.sets === null || p.sets === '' ? 0 : nonNegInt(p.sets, 'Sets')
  const { item, comps } = await lockKit(client, p.itemId)
  const byId = new Map(comps.map((c) => [c.id, c]))

  const compOut = await componentOutstanding(client, item.id, p.recipient, p.department)
  const setsOut = await setsOutstanding(client, item.id, p.recipient, p.department)
  if (sets > setsOut) {
    throw bad(`Cannot return more than outstanding (${setsOut}) sets for ${p.recipient}`)
  }

  let returned
  if (p.lines) {
    returned = normaliseLines(p.lines, byId, { allowZero: true })
  } else {
    if (!sets) throw bad('Nothing to return')
    returned = new Map(comps.map((c) => [c.id, Math.min(sets * c.quantity_per_kit, compOut.get(c.id) || 0)]))
  }
  for (const [id, r] of returned) {
    const out = compOut.get(id) || 0
    if (r > out) {
      throw bad(`Cannot return ${r} × "${byId.get(id).name}" – only ${out} outstanding for ${p.recipient}`)
    }
  }
  const totalPieces = [...returned.values()].reduce((a, b) => a + b, 0)
  if (!sets && !totalPieces) throw bad('Nothing to return')

  // Which pieces are missing from the sets being handed back?
  // `stockGap` drives the stock maths (does a full set come back in this call?). `missing` is
  // what is reported / noted: only pieces this person still has out, so pieces they returned
  // earlier on their own are not flagged as missing again.
  const missing = []
  let stockGap = false
  if (sets) {
    for (const c of comps) {
      const gap = sets * c.quantity_per_kit - (returned.get(c.id) || 0)
      if (gap > 0) {
        stockGap = true
        const stillOut = (compOut.get(c.id) || 0) - (returned.get(c.id) || 0)
        const real = Math.min(gap, stillOut)
        if (real > 0) missing.push(`${real} × ${c.name}`)
      }
    }
  }
  const complete = sets > 0 && !stockGap

  // Stock: complete sets snap back together; everything else goes to the loose pool.
  if (complete) await setSets(client, item.id, sets)
  for (const c of comps) {
    const r = returned.get(c.id) || 0
    const toLoose = complete ? r - sets * c.quantity_per_kit : r
    if (toLoose) await setLoose(client, c.id, c.loose_quantity + toLoose)
  }

  // Always attribute the return to the original issue context(s) via FIFO so event logs and
  // SOURCE stay correct. Client source/eventId are ignored (same as plain-item returns).
  // Set lines are matched against set-level issues, each piece against that piece's own issues
  // (pieces issued one by one have no set-level line). One row per (source, event) slice.
  const { resolveReturnAttribution } = await import('./returns.js')
  const dept = p.department
  const common = {
    itemId: item.id, type: 'return',
    recipient: p.recipient, department: p.department, performedBy: p.performedBy,
  }
  const notes = [p.notes, missing.length ? `Incomplete – missing: ${missing.join(', ')}` : null]
    .filter(Boolean).join(' · ') || null

  let parent = null
  if (sets) {
    const setSlices = await resolveReturnAttribution(client, item.id, p.recipient, dept, sets, null)
    for (const sl of setSlices) {
      const row = await insertTxn(client, {
        ...common, source: sl.source, eventId: sl.eventId,
        quantity: sl.quantity, unitId: p.unitId, unitQuantity: sl.quantity, notes,
      })
      if (!parent) parent = row
    }
  }
  const children = []
  for (const c of comps) {
    const r = returned.get(c.id) || 0
    if (!r) continue
    const slices = await resolveReturnAttribution(client, item.id, p.recipient, dept, r, c.id)
    for (const sl of slices) {
      children.push(await insertTxn(client, {
        ...common, source: sl.source, eventId: sl.eventId,
        quantity: sl.quantity, componentId: c.id, parentId: parent?.id,
        notes: parent ? null : p.notes,
      }))
    }
  }
  // If every piece behind a set has come back one by one, the set itself is no longer out.
  // Without this the set-level balance stays open forever ("1 set out" with nothing out).
  // Ledger-only: stock was already updated above, and nothing is closed while any piece that
  // could belong to the set is still outstanding.
  const setsLeft = setsOut - sets
  if (setsLeft > 0) {
    let stillNeeded = 0
    for (const c of comps) {
      const left = (compOut.get(c.id) || 0) - (returned.get(c.id) || 0)
      if (left > 0) stillNeeded = Math.max(stillNeeded, Math.ceil(left / c.quantity_per_kit))
    }
    const toClose = setsLeft - stillNeeded
    if (toClose > 0) {
      const closeSlices = await resolveReturnAttribution(client, item.id, p.recipient, dept, toClose, null)
      for (const sl of closeSlices) {
        await insertTxn(client, {
          ...common, source: sl.source, eventId: sl.eventId,
          quantity: sl.quantity, unitQuantity: sl.quantity,
          notes: 'Auto-closed: all pieces of this set have been returned',
        })
      }
    }
  }
  const autoRepacked = await autoRepack(client, item.id)
  return { parent, children, complete, missing, autoRepacked }
}

/**
 * Book back everything one recipient still has of a kit: all outstanding sets and every
 * outstanding piece. Returns null when nothing is out.
 */
export async function returnKitEverything(client, p) {
  const { item, comps } = await lockKit(client, p.itemId)
  const compOut = await componentOutstanding(client, item.id, p.recipient, p.department)
  const sets = Math.max(0, await setsOutstanding(client, item.id, p.recipient, p.department))
  const lines = comps
    .filter((c) => (compOut.get(c.id) || 0) > 0)
    .map((c) => ({ componentId: c.id, quantity: compOut.get(c.id) }))
  if (!sets && !lines.length) return null
  const res = await returnKit(client, {
    itemId: item.id, sets, lines, recipient: p.recipient, department: p.department,
    notes: p.notes, performedBy: p.performedBy,
  })
  return {
    sets, pieces: lines.reduce((t, l) => t + l.quantity, 0),
    missing: res.missing, autoRepacked: res.autoRepacked,
  }
}

/* ---------------------------------------------------------------- receive */

/** Receive loose replacement pieces (e.g. a lost screwdriver bought separately). */
export async function receivePieces(client, p) {
  const { item, comps } = await lockKit(client, p.itemId)
  const byId = new Map(comps.map((c) => [c.id, c]))
  const lines = normaliseLines(p.lines, byId)
  if (!lines.size) throw bad('Enter a quantity for at least one piece')
  const txns = []
  for (const [id, k] of lines) {
    const c = byId.get(id)
    await setLoose(client, id, c.loose_quantity + k)
    txns.push(await insertTxn(client, {
      itemId: item.id, type: 'receive', quantity: k, componentId: id,
      source: p.source, vendor: p.vendor, notes: p.notes, performedBy: p.performedBy,
    }))
  }
  const autoRepacked = await autoRepack(client, item.id)
  return { transactions: txns, autoRepacked }
}

/* ----------------------------------------------------------------- repack */

export function repackableSets(comps) {
  if (!comps.length) return 0
  return Math.min(...comps.map((c) => Math.floor(c.loose_quantity / c.quantity_per_kit)))
}

/**
 * Snap loose pieces back into complete sets whenever a full set's worth exists.
 * Called inside the same transaction after pieces come back to store (returns, received
 * replacements), so stock stays correct without anyone pressing "Repack". It only moves
 * pieces between the "loose" pool and the complete-set count – total pieces never change.
 * Returns how many sets were formed (0 when nothing to do).
 */
async function autoRepack(client, itemId) {
  const { rows: comps } = await client.query(
    `SELECT * FROM kit_components WHERE kit_id = $1 AND is_active
     ORDER BY position, name FOR UPDATE`,
    [itemId]
  )
  const n = repackableSets(comps)
  if (n < 1) return 0
  await setSets(client, itemId, n)
  for (const c of comps) await setLoose(client, c.id, c.loose_quantity - n * c.quantity_per_kit)
  return n
}

/** Turn loose pieces back into complete sets. */
export async function repackKit(client, itemId, requested) {
  const { item, comps } = await lockKit(client, itemId)
  const max = repackableSets(comps)
  if (max < 1) throw bad('There are not enough loose pieces to form a complete set')
  const n = requested ? positiveInt(requested, 'Sets to repack') : max
  if (n > max) throw bad(`Only ${max} complete set(s) can be formed from loose pieces`)
  await setSets(client, item.id, n)
  for (const c of comps) await setLoose(client, c.id, c.loose_quantity - n * c.quantity_per_kit)
  return n
}

/* ------------------------------------------------------------ total sets */

/**
 * How many sets the store owns in total: complete sets on the shelf + sets opened + sets
 * issued out. Worked out from the pieces: for each piece, (in store + out) / per set, and
 * the highest of those wins (so one lost piece does not shrink the total, and replacements
 * bought separately are not lost either). `parts` = [{ perKit, inStore, out }].
 * Kits without a piece list: sets on the shelf + sets out.
 */
export function ownedSetsFrom(quantity, setsOut, parts) {
  if (!parts.length) return Number(quantity) + Number(setsOut || 0)
  return Math.max(...parts.map((p) => Math.ceil((p.inStore + p.out) / p.perKit)))
}

/** Same number, read from the database (inside a transaction, after the kit row is locked). */
export async function ownedSets(client, kitId) {
  const { rows: [it] } = await client.query('SELECT quantity FROM items WHERE id = $1', [kitId])
  const quantity = Number(it.quantity)
  const { rows } = await client.query(
    `SELECT c.quantity_per_kit, c.loose_quantity, COALESCE(o.out, 0) AS out
     FROM kit_components c
     LEFT JOIN (
       SELECT component_id, SUM(GREATEST(0, bal)) AS out FROM (
         SELECT component_id,
                SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END)
              - SUM(CASE WHEN type='return' THEN quantity ELSE 0 END) AS bal
         FROM transactions
         WHERE item_id = $1 AND component_id IS NOT NULL AND recipient IS NOT NULL AND recipient <> ''
         GROUP BY component_id, recipient, COALESCE(department, '')
       ) per GROUP BY component_id
     ) o ON o.component_id = c.id
     WHERE c.kit_id = $1 AND c.is_active`,
    [kitId]
  )
  const parts = rows.map((r) => ({
    perKit: r.quantity_per_kit,
    inStore: quantity * r.quantity_per_kit + r.loose_quantity,
    out: Number(r.out),
  }))
  let setsOut = 0
  if (!parts.length) setsOut = await setsOutstandingAll(client, kitId)
  return ownedSetsFrom(quantity, setsOut, parts)
}

async function setsOutstandingAll(client, kitId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(GREATEST(0, bal)), 0) AS out FROM (
       SELECT SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END)
            - SUM(CASE WHEN type='return' THEN quantity ELSE 0 END) AS bal
       FROM transactions
       WHERE item_id = $1 AND component_id IS NULL AND recipient IS NOT NULL AND recipient <> ''
       GROUP BY recipient, COALESCE(department, '')
     ) x`,
    [kitId]
  )
  return Number(rows[0].out)
}

/**
 * Set the TOTAL number of sets owned (what the Edit Item form asks for). The complete sets on
 * the shelf are then adjusted by the difference; loose pieces and what is out are untouched.
 * Refused when the total would be lower than the sets already opened or out.
 */
export async function setTotalSets(client, kitId, total) {
  const target = nonNegInt(total, 'Total sets')
  await client.query('SELECT id FROM items WHERE id = $1 FOR UPDATE', [kitId])
  await client.query('SELECT id FROM kit_components WHERE kit_id = $1 AND is_active FOR UPDATE', [kitId])
  const owned = await ownedSets(client, kitId)
  const { rows: [it] } = await client.query('SELECT quantity FROM items WHERE id = $1', [kitId])
  const onShelf = Number(it.quantity)
  const next = onShelf + (target - owned)
  if (next < 0) {
    throw new HttpError(
      409,
      `Total sets can't be less than ${owned - onShelf}: that many are already opened or issued out.`
    )
  }
  if (next !== onShelf) await setSets(client, kitId, next - onShelf)
  return next
}

/* ------------------------------------------------- composition (the form) */

/** Validate the component list coming from the item form. */
export function validateComponentsInput(list) {
  if (!Array.isArray(list)) throw bad('components must be a list')
  const seen = new Set()
  return list.map((c, idx) => {
    const name = String(c.name || '').trim()
    if (!name) throw bad(`Component ${idx + 1} needs a name`)
    const key = name.toLowerCase()
    if (seen.has(key)) throw bad(`"${name}" is listed more than once – use its quantity instead`)
    seen.add(key)
    return {
      id: c.id || null,
      name,
      quantityPerKit: positiveInt(c.quantityPerKit ?? 1, `Quantity of "${name}" per set`),
      notes: c.notes ? String(c.notes).trim() : null,
      position: idx,
    }
  })
}

/**
 * Make a kit's component rows match `list`.
 * - Changing contents (add / remove / per-set quantity) is refused while sets are out,
 *   because returns are checked against what was issued.
 * - Removing a component that has history archives it instead of deleting it.
 */
export async function syncComponents(client, kitId, list) {
  const input = validateComponentsInput(list)
  const { rows: existing } = await client.query(
    'SELECT * FROM kit_components WHERE kit_id=$1 AND is_active ORDER BY position FOR UPDATE',
    [kitId]
  )
  const byId = new Map(existing.map((c) => [c.id, c]))
  for (const c of input) {
    if (c.id && !byId.has(c.id)) throw bad('A component in the list no longer exists – reload and try again')
  }
  const keepIds = new Set(input.filter((c) => c.id).map((c) => c.id))
  const removed = existing.filter((c) => !keepIds.has(c.id))
  const added = input.filter((c) => !c.id)
  const requantified = input.filter((c) => c.id && byId.get(c.id).quantity_per_kit !== c.quantityPerKit)

  if (removed.length || added.length || requantified.length) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(GREATEST(0, bal)),0) AS out FROM (
         SELECT SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END)
              - SUM(CASE WHEN type='return' THEN quantity ELSE 0 END) AS bal
         FROM transactions
         WHERE item_id=$1 AND component_id IS NULL AND recipient IS NOT NULL AND recipient <> ''
         GROUP BY recipient, COALESCE(department,'')
       ) x`,
      [kitId]
    )
    if (Number(rows[0].out) > 0) {
      throw new HttpError(409, 'Sets of this kit are currently issued out. Return them before changing what is in the kit (names and notes can still be edited).')
    }
  }

  for (const c of removed) {
    const { rows } = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM transactions WHERE component_id=$1)::int AS used,
         COALESCE((SELECT SUM(CASE WHEN type='issue' THEN quantity WHEN type='return' THEN -quantity ELSE 0 END)
                   FROM transactions WHERE component_id=$1),0) AS net`,
      [c.id]
    )
    if (Number(rows[0].net) > 0) {
      throw new HttpError(409, `"${c.name}" still has pieces issued out. Return them before removing it from the kit.`)
    }
    if (rows[0].used > 0) {
      await client.query('UPDATE kit_components SET is_active=FALSE WHERE id=$1', [c.id])
    } else {
      await client.query('DELETE FROM kit_components WHERE id=$1', [c.id])
    }
  }
  for (const c of input) {
    if (c.id) {
      await client.query(
        `UPDATE kit_components SET name=$1, quantity_per_kit=$2, notes=$3, position=$4 WHERE id=$5`,
        [c.name, c.quantityPerKit, c.notes, c.position, c.id]
      )
    } else {
      await client.query(
        `INSERT INTO kit_components (kit_id, name, quantity_per_kit, notes, position)
         VALUES ($1,$2,$3,$4,$5)`,
        [kitId, c.name, c.quantityPerKit, c.notes, c.position]
      )
    }
  }
}
