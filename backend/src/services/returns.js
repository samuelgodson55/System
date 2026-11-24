/**
 * Returns of plain (non-kit) items and "return everything" for one person.
 *
 * Consumables can be returned too (e.g. a pack of gloves handed out by mistake and brought
 * back unopened). Because a consumable is normally used up, its "balance" is simply
 * issued − already returned for that person; the cap keeps the ledger honest but cannot know
 * what was actually consumed, so staff decide whether the goods are fit to go back on the shelf.
 *
 * Every function expects to run inside withTransaction().
 *
 * Source / event attribution
 * --------------------------
 * A return must reverse the *context* of the original issue(s) so that:
 *   - Event history shows the return (event_id is set)
 *   - Item history shows SOURCE = Event / Site correctly
 *
 * Client-supplied source/eventId are ignored for returns. We always allocate the
 * returned quantity against outstanding issue lines in FIFO order (oldest issue
 * first) and write one return row per distinct (source, event_id) bucket. That
 * keeps stock and event nets accurate without requiring the user to re-select
 * the event, and prevents accidental "site" returns when the stock was issued
 * under an event.
 */
import { HttpError, activeComponentCount, returnKitEverything } from './kits.js'
import { applyStockDelta, tidyQty, QTY_EPSILON } from './itemUnits.js'

const bad = (msg) => new HttpError(400, msg)

/** issued − returned of an item (whole-item lines only) for one recipient + department. */
export async function returnableBalance(client, itemId, recipient, department) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN type = 'issue' THEN quantity ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN type = 'return' THEN quantity ELSE 0 END), 0) AS outstanding
     FROM transactions
     WHERE item_id = $1 AND recipient = $2 AND component_id IS NULL
       AND COALESCE(department, '') = $3`,
    [itemId, recipient, department || '']
  )
  return tidyQty(rows[0]?.outstanding || 0)
}

/**
 * Build FIFO open-issue buckets for (item, recipient, department).
 * Each bucket is { source, eventId, openQty } and the list is ordered oldest-first.
 * Open qty is computed by walking issues then returns in time order so partial returns
 * against mixed site/event issues are attributed correctly.
 */
export async function openIssueBuckets(client, itemId, recipient, department, componentId = null) {
  const { rows } = await client.query(
    `SELECT type, quantity, source, event_id, created_at
     FROM transactions
     WHERE item_id = $1 AND recipient = $2
       AND COALESCE(department, '') = $3
       AND (($4::uuid IS NULL AND component_id IS NULL) OR component_id = $4)
     ORDER BY created_at ASC, id ASC`,
    [itemId, recipient, department || '', componentId]
  )

  // Running open lots: [{ source, eventId, qty }]
  const lots = []
  for (const r of rows) {
    const q = Number(r.quantity) || 0
    if (r.type === 'issue') {
      lots.push({
        source: r.source || 'site',
        eventId: r.event_id || null,
        qty: q,
      })
    } else if (r.type === 'return') {
      let left = q
      while (left > QTY_EPSILON && lots.length) {
        const lot = lots[0]
        const take = Math.min(lot.qty, left)
        lot.qty = tidyQty(lot.qty - take)
        left = tidyQty(left - take)
        if (lot.qty <= QTY_EPSILON) lots.shift()
      }
    }
  }

  // Merge adjacent identical (source, eventId) for cleaner return rows
  const buckets = []
  for (const lot of lots) {
    if (lot.qty <= QTY_EPSILON) continue
    const last = buckets[buckets.length - 1]
    if (
      last &&
      last.source === lot.source &&
      (last.eventId || null) === (lot.eventId || null)
    ) {
      last.openQty = tidyQty(last.openQty + lot.qty)
    } else {
      buckets.push({
        source: lot.source || 'site',
        eventId: lot.eventId || null,
        openQty: tidyQty(lot.qty),
      })
    }
  }
  return buckets
}

/**
 * Allocate `qty` against openIssueBuckets (FIFO). Returns one or more
 * { quantity, source, eventId } slices that sum to min(qty, total open).
 */
export function allocateReturnQty(buckets, qty) {
  let left = tidyQty(qty)
  const slices = []
  for (const b of buckets) {
    if (left <= QTY_EPSILON) break
    const take = tidyQty(Math.min(b.openQty, left))
    if (take <= QTY_EPSILON) continue
    slices.push({
      quantity: take,
      source: b.eventId ? 'event' : (b.source || 'site'),
      eventId: b.eventId || null,
    })
    left = tidyQty(left - take)
  }
  return slices
}

/**
 * Resolve source + eventId for a return when the client did not supply them.
 * Uses FIFO open-issue buckets. If everything is under one context, returns a single slice;
 * if mixed, returns multiple slices so each event gets its return recorded.
 */
export async function resolveReturnAttribution(client, itemId, recipient, department, qty, componentId = null) {
  const buckets = await openIssueBuckets(client, itemId, recipient, department, componentId)
  const slices = allocateReturnQty(buckets, qty)
  if (!slices.length) {
    // Nothing open attributed – fall back to site so stock still comes back
    return [{ quantity: tidyQty(qty), source: 'site', eventId: null }]
  }
  const allocated = tidyQty(slices.reduce((s, x) => s + x.quantity, 0))
  const remainder = tidyQty(qty - allocated)
  if (remainder > QTY_EPSILON) {
    // Should not happen if returnableBalance was checked, but keep ledger consistent
    slices.push({ quantity: remainder, source: 'site', eventId: null })
  }
  return slices
}

/**
 * Return everything one person still has out, for the given items, in a single
 * transaction: either all of it is booked back or none of it is.
 * Consumables are refused here on purpose – they must be returned one at a time with the
 * exact quantity, otherwise "return all" would put used-up stock back on the shelf.
 *
 * Each item's return is attributed to the original issue source(s)/event(s) via FIFO.
 */
export async function returnEverything(client, p) {
  const recipient = String(p.recipient || '').trim()
  if (!recipient) throw bad('Recipient is required for returns')
  const department = String(p.department || '').trim()
  const ids = [...new Set(p.itemIds || [])].sort() // fixed order → no deadlocks between requests
  if (!ids.length) throw bad('Select at least one item to return')
  if (ids.length > 100) throw bad('Too many items in one return (max 100)')

  const returned = []
  const skipped = []
  for (const itemId of ids) {
    const { rows } = await client.query(
      'SELECT id, name, quantity, item_type FROM items WHERE id = $1 FOR UPDATE',
      [itemId]
    )
    const item = rows[0]
    if (!item) throw new HttpError(404, 'An item in the list no longer exists')
    if (item.item_type === 'consumable') {
      throw bad(`"${item.name}" is a consumable – return it on its own with the exact quantity`)
    }

    if (item.item_type === 'kit' && (await activeComponentCount(client, itemId)) > 0) {
      const res = await returnKitEverything(client, {
        itemId, recipient, department, notes: p.notes, performedBy: p.performedBy,
      })
      if (!res) skipped.push({ itemId, itemName: item.name })
      else returned.push({ itemId, itemName: item.name, kind: 'kit', sets: res.sets, pieces: res.pieces, missing: res.missing })
      continue
    }

    const qty = await returnableBalance(client, itemId, recipient, department)
    if (!(qty > QTY_EPSILON)) {
      skipped.push({ itemId, itemName: item.name })
      continue
    }
    await applyStockDelta(client, itemId, qty)

    const slices = await resolveReturnAttribution(client, itemId, recipient, department, qty)
    for (const slice of slices) {
      await client.query(
        `INSERT INTO transactions
         (item_id, type, quantity, unit_quantity, source, event_id, recipient, department, notes, performed_by)
         VALUES ($1,'return',$2,$2,$3,$4,$5,$6,$7,$8)`,
        [
          itemId,
          slice.quantity,
          slice.source,
          slice.eventId,
          recipient,
          department || null,
          p.notes || null,
          p.performedBy || 'Unknown',
        ]
      )
    }
    returned.push({ itemId, itemName: item.name, kind: 'item', quantity: qty })
  }

  if (!returned.length) {
    throw new HttpError(409, `Nothing is outstanding for ${recipient} any more – refresh the list`)
  }
  return { returned, skipped }
}
