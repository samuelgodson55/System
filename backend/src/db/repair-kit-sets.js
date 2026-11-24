/**
 * One-off repair: close kit "set" balances that have no pieces behind them.
 *
 * Before the kit-return fix, returning every piece of a set one by one (pieces-only) left the
 * set-level balance open, so the kit showed "N sets out" and stayed in Everything out with
 * nothing actually out. This adds the missing set-level return line for those cases.
 *
 * Safety
 *  - DRY RUN by default: prints what it would do and changes nothing. Pass --apply to write.
 *  - Only INSERTS ledger lines (type 'return', performed by "System repair"). It never edits or
 *    deletes anything, and never touches stock (items.quantity / loose_quantity): the pieces
 *    already went back into stock when they were returned.
 *  - Never closes a set while any piece that could belong to it is still outstanding
 *    (same rule as the live fix in services/kits.js).
 *  - Each kit is repaired in its own transaction with the kit locked; safe to run while the
 *    app is in use, and safe to run again (a second run finds nothing to do).
 *
 * Usage (from the backend container):
 *   node src/db/repair-kit-sets.js            # preview
 *   node src/db/repair-kit-sets.js --apply    # write the fixes
 * Take a backup first (Backup page) as usual.
 */
import { pool, withTransaction } from './pool.js'

const APPLY = process.argv.includes('--apply')
const NOTE = 'Auto-closed (repair): all pieces of this set had been returned'

async function repairKit(client, kit) {
  await client.query('SELECT id FROM items WHERE id = $1 FOR UPDATE', [kit.id])
  const { rows: comps } = await client.query(
    'SELECT id, quantity_per_kit FROM kit_components WHERE kit_id = $1 AND is_active FOR UPDATE',
    [kit.id]
  )
  const { rows: setRows } = await client.query(
    `SELECT recipient, COALESCE(department,'') AS department,
            SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END)
          - SUM(CASE WHEN type='return' THEN quantity ELSE 0 END) AS bal
     FROM transactions
     WHERE item_id = $1 AND component_id IS NULL AND recipient IS NOT NULL AND recipient <> ''
     GROUP BY recipient, COALESCE(department,'')`,
    [kit.id]
  )
  const { rows: compRows } = await client.query(
    `SELECT recipient, COALESCE(department,'') AS department, component_id,
            SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END)
          - SUM(CASE WHEN type='return' THEN quantity ELSE 0 END) AS bal
     FROM transactions
     WHERE item_id = $1 AND component_id IS NOT NULL AND recipient IS NOT NULL AND recipient <> ''
     GROUP BY recipient, COALESCE(department,''), component_id`,
    [kit.id]
  )
  const perComp = new Map(comps.map((c) => [c.id, c.quantity_per_kit]))
  const out = []
  for (const s of setRows) {
    const setsOut = Number(s.bal)
    if (!(setsOut > 0)) continue
    let stillNeeded = 0
    for (const r of compRows) {
      if (r.recipient !== s.recipient || r.department !== s.department) continue
      const bal = Number(r.bal)
      const per = perComp.get(r.component_id)
      if (bal > 0) {
        // a piece we cannot place (archived component) -> be conservative, keep the set open
        stillNeeded = Math.max(stillNeeded, per ? Math.ceil(bal / per) : setsOut)
      }
    }
    const toClose = setsOut - stillNeeded
    if (toClose > 0) out.push({ recipient: s.recipient, department: s.department, toClose })
  }
  if (APPLY) {
    for (const o of out) {
      await client.query(
        `INSERT INTO transactions
         (item_id, type, quantity, unit_quantity, source, recipient, department, notes, performed_by)
         VALUES ($1,'return',$2,$2,'site',$3,$4,$5,'System repair')`,
        [kit.id, o.toClose, o.recipient, o.department || null, NOTE]
      )
    }
  }
  return out
}

async function main() {
  const { rows: kits } = await pool.query(
    `SELECT id, name, sku FROM items WHERE item_type = 'kit' ORDER BY name`
  )
  let total = 0
  for (const kit of kits) {
    const fixed = await withTransaction((client) => repairKit(client, kit))
    for (const f of fixed) {
      total += f.toClose
      console.log(
        `${APPLY ? 'closed' : 'would close'} ${f.toClose} set(s) of "${kit.name}" (${kit.sku})` +
        ` for ${f.recipient}${f.department ? ' / ' + f.department : ''}`
      )
    }
  }
  console.log(
    total === 0
      ? 'Nothing to repair.'
      : APPLY
        ? `Done: closed ${total} stuck set balance(s).`
        : `Preview only: ${total} stuck set balance(s). Re-run with --apply to fix them.`
  )
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
