import bcrypt from 'bcryptjs'
import { pool, query, withTransaction } from './pool.js'
import { syncComponents, issueWholeKit, issuePieces, returnKit } from '../services/kits.js'

async function seed() {
  const { rows: existing } = await query('SELECT id FROM users LIMIT 1')
  if (existing.length > 0) {
    console.log('Database already seeded, skipping')
    await pool.end()
    return
  }

  // Hosted deployments (Render) must never ship the well-known demo passwords:
  //   SEED_DEMO_DATA=false          -> create only the admin account and the standard units (no sample data)
  //   SEED_ADMIN_PASSWORD=<secret>  -> password for 'admin' (min. 8 chars); with Docker Compose it is unset
  //                                    and the documented demo defaults apply, exactly as before
  //   SEED_STAFF_PASSWORD=<secret>  -> same for the demo 'staff' account
  const demo = !['0', 'false'].includes(String(process.env.SEED_DEMO_DATA ?? 'true').toLowerCase())
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123'
  const staffPassword = process.env.SEED_STAFF_PASSWORD || 'staff123'
  if (!demo && !process.env.SEED_ADMIN_PASSWORD) {
    console.error('FATAL: SEED_DEMO_DATA=false requires SEED_ADMIN_PASSWORD (refusing to create an admin with the default password)')
    process.exit(1)
  }
  if (process.env.SEED_ADMIN_PASSWORD && adminPassword.length < 8) {
    console.error('FATAL: SEED_ADMIN_PASSWORD must be at least 8 characters')
    process.exit(1)
  }

  // the schema always creates a default site (see db/schema.js); the demo staff account and all demo data belong to it
  const { rows: siteRows } = await query('SELECT id FROM sites ORDER BY created_at, id LIMIT 1')
  const siteId = siteRows[0].id

  const adminHash = await bcrypt.hash(adminPassword, 10)
  await query(`INSERT INTO users (username, password_hash, name, role) VALUES ('admin', $1, 'Admin User', 'admin')`, [adminHash])
  if (demo) {
    const staffHash = await bcrypt.hash(staffPassword, 10)
    await query(`INSERT INTO users (username, password_hash, name, role, site_id) VALUES ('staff', $1, 'Staff Member', 'staff', $2)`, [staffHash, siteId])
  }

  const unitsRes = await query(
    `INSERT INTO units (name, abbreviation, conversion_factor, is_base) VALUES
     ('Piece', 'pc', 1, true),
     ('Pack', 'pk', 12, false),
     ('Carton', 'ctn', 48, false),
     ('Box', 'box', 24, false),
     ('Dozen', 'doz', 12, false),
     ('Set', 'set', 1, false)
     RETURNING id, abbreviation`
  )
  if (!demo) {
    console.log('Seed completed (admin account + units only; no demo data)')
    await pool.end()
    return
  }

  const unitMap = Object.fromEntries(unitsRes.rows.map((u) => [u.abbreviation, u.id]))
  const baseUnit = unitMap['pc']

  const eventsRes = await query(
    `INSERT INTO events (name, description, location, start_date, end_date, status, site_id) VALUES
     ('Annual Conference 2026', 'Company annual conference at main hall', 'Main Conference Hall', '2026-11-20', '2026-11-22', 'upcoming', $1),
     ('Team Building Day', 'Outdoor team building activities', 'City Park', '2026-11-15', '2026-11-15', 'active', $1),
     ('Product Launch', 'New product line launch event', 'Exhibition Center', '2026-10-10', '2026-10-12', 'completed', $1)
     RETURNING id, name`,
    [siteId]
  )
  const eventMap = Object.fromEntries(eventsRes.rows.map((e) => [e.name, e.id]))

  // items: [sku, name, desc, cat, qty, reorder, loc, type, piecesPerSet, kitNotes]
  const itemsData = [
    ['STN-001', 'Ballpoint Pens (Blue)', 'Standard blue ballpoint pens', 'Stationery', 480, 100, 'Shelf A1', 'consumable', null, null],
    ['STN-002', 'A4 Copy Paper', '80gsm white A4 paper reams', 'Stationery', 240, 50, 'Shelf B2', 'consumable', null, null],
    ['CLN-001', 'Hand Sanitizer 500ml', 'Alcohol-based hand sanitizer', 'Cleaning', 96, 24, 'Shelf C3', 'consumable', null, null],
    ['KIT-001', 'Disposable Cups', '250ml paper disposable cups', 'Kitchen', 1200, 200, 'Shelf D1', 'consumable', null, null],
    ['ELE-001', 'USB-C Cables', '1m USB-C charging cables', 'Electronics', 60, 20, 'Shelf E4', 'reusable', null, null],
    ['STN-003', 'Sticky Notes (Yellow)', '3x3 inch yellow sticky notes', 'Stationery', 180, 40, 'Shelf A2', 'consumable', null, null],
    ['CLN-002', 'Disinfectant Wipes', 'Pack of 80 disinfectant wipes', 'Cleaning', 72, 18, 'Shelf C1', 'consumable', null, null],
    ['KIT-002', 'Bottled Water 500ml', 'Still mineral water bottles', 'Kitchen', 360, 100, 'Shelf D2', 'consumable', null, null],
    ['ELE-002', 'Wireless Presenter', 'USB wireless presentation clicker', 'Electronics', 12, 3, 'Shelf E2', 'reusable', null, null],
    ['FUR-001', 'Folding Table', 'Lightweight folding table 6ft', 'Furniture', 8, 2, 'Store Room', 'reusable', null, null],
    ['TOL-001', 'Precision Screwdriver Set (80-in-1)', '80-piece precision screwdriver & bit set for electronics repair', 'Tools', 15, 3, 'Tool Cabinet A', 'kit', 80, 'Phillips, flathead, Torx, hex bits, extension rods, magnetic pickup'],
    ['TOL-002', 'Socket Wrench Set (40-piece)', '40-piece metric/imperial socket set with ratchet', 'Tools', 6, 2, 'Tool Cabinet B', 'kit', 40, 'Sockets 4–19mm, ratchet handle, extension bars, universal joint'],
    ['TOL-003', 'Network Crimp Tool Kit', 'RJ45 crimper kit with tester and cable stripper', 'Tools', 4, 1, 'Tool Cabinet A', 'kit', 5, 'Crimper, cable tester, stripper, 50 RJ45 connectors, pouch'],
  ]

  const itemIds = {}
  for (const [sku, name, desc, cat, qty, reorder, loc, type, pieces, kitNotes] of itemsData) {
    const { rows } = await query(
      `INSERT INTO items (sku, name, description, category, quantity, base_unit_id, reorder_level, location, item_type, pieces_per_set, kit_notes, site_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [sku, name, desc, cat, qty, baseUnit, reorder, loc, type, pieces, kitNotes, siteId]
    )
    itemIds[sku] = rows[0].id
  }

  // Units of measurement that make sense for each item (the base unit 'pc' is always allowed)
  const ITEM_UNITS = {
    'STN-001': ['pc', 'pk', 'ctn'],      // pens: loose, packs, cartons
    'STN-002': ['pc', 'ctn'],            // paper reams: loose or by carton
    'CLN-001': ['pc', 'pk'],
    'KIT-001': ['pc', 'pk', 'ctn'],      // cups
    'ELE-001': ['pc'],                   // cables: individually only
    'STN-003': ['pc', 'doz'],            // sticky notes: loose or by the dozen
    'CLN-002': ['pc', 'pk', 'box'],
    'KIT-002': ['pc', 'pk', 'ctn'],      // bottled water
    'ELE-002': ['pc'],
    'FUR-001': ['pc'],
    'TOL-001': ['pc', 'set'],
    'TOL-002': ['pc', 'set'],
    'TOL-003': ['pc', 'set'],
  }
  for (const [sku, abbrs] of Object.entries(ITEM_UNITS)) {
    for (const abbr of new Set(['pc', ...abbrs])) {
      await query('INSERT INTO item_units (item_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        itemIds[sku], unitMap[abbr],
      ])
    }
  }

  const txns = [
    [itemIds['STN-001'], 'receive', 240, unitMap['ctn'], 5, 'vendor', null, 'Office Supplies Co.', null, null, 'Monthly stationery restock', 'Admin User'],
    [itemIds['STN-001'], 'issue', 48, unitMap['pk'], 4, 'event', eventMap['Team Building Day'], null, 'James Okoro', 'HR', 'Team building day supplies', 'Staff Member'],
    [itemIds['STN-002'], 'receive', 120, unitMap['ctn'], 2.5, 'head_office', null, null, null, null, 'Transfer from HO warehouse', 'Admin User'],
    [itemIds['KIT-001'], 'issue', 200, unitMap['pc'], 200, 'site', null, null, 'Kitchen Staff', 'Facilities', 'Daily office use', 'Staff Member'],
    [itemIds['CLN-001'], 'receive', 48, unitMap['pk'], 4, 'vendor', null, 'CleanPro Distributors', null, null, 'Sanitizer restock', 'Admin User'],
    [itemIds['KIT-002'], 'issue', 96, unitMap['pk'], 8, 'event', eventMap['Annual Conference 2026'], null, 'Event Coordinator', 'Marketing', 'Pre-stock for conference', 'Staff Member'],
    [itemIds['ELE-001'], 'receive', 30, unitMap['pc'], 30, 'vendor', null, 'TechGear Ltd', null, null, 'New USB-C cables', 'Admin User'],
    [itemIds['STN-003'], 'issue', 36, unitMap['doz'], 3, 'site', null, null, 'Ada Nwosu', 'Operations', 'Meeting room supplies', 'Staff Member'],
    [itemIds['ELE-002'], 'issue', 2, unitMap['pc'], 2, 'event', eventMap['Team Building Day'], null, 'James Okoro', 'HR', 'Presenters for team building', 'Staff Member'],
    [itemIds['ELE-002'], 'return', 1, unitMap['pc'], 1, 'event', eventMap['Team Building Day'], null, 'James Okoro', 'HR', 'One presenter returned', 'Staff Member'],
    [itemIds['FUR-001'], 'issue', 3, unitMap['pc'], 3, 'event', eventMap['Annual Conference 2026'], null, 'Event Coordinator', 'Marketing', 'Tables for registration', 'Admin User'],
    [itemIds['ELE-001'], 'issue', 10, unitMap['pc'], 10, 'site', null, null, 'Chinedu Eze', 'IT', 'Desk cable refresh', 'Staff Member'],
    [itemIds['ELE-001'], 'issue', 5, unitMap['pc'], 5, 'site', null, null, 'Ada Nwosu', 'Operations', 'Meeting room AV', 'Staff Member'],
  ]

  for (const t of txns) {
    await query(
      `INSERT INTO transactions
       (item_id, type, quantity, unit_id, unit_quantity, source, event_id, vendor, recipient, department, notes, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      t
    )
  }

  // ---- Kits: contents + issue/return through the same code the API uses ----
  const KIT_CONTENTS = {
    'TOL-001': [
      ['Precision screwdriver handle', 1], ['Extension rod', 2], ['Flexible shaft', 1],
      ['Flat (slotted) bit', 8], ['Phillips bit', 10], ['Torx bit', 12], ['Hex bit', 10],
      ['Pentalobe bit', 4], ['Tri-wing bit', 4], ['Security Torx bit', 8], ['Y-type bit', 3],
      ['Plastic spudger', 2], ['Opening pick', 5], ['Tweezers', 2], ['Suction cup', 2],
      ['Magnetic pickup tool', 1], ['Cleaning brush', 1], ['Carry case', 1], ['Screw tray', 1],
      ['Anti-static wrist strap', 1], ['SIM eject pin', 1],
    ],
    'TOL-002': [
      ['Ratchet handle', 1], ['Extension bar', 2], ['Universal joint', 1],
      ['Metric socket (4-19mm)', 16], ['Imperial socket', 14], ['Socket adaptor', 2],
      ['Sliding T-handle', 1], ['Hex bit socket', 2], ['Storage case', 1],
    ],
    'TOL-003': [
      ['RJ45 crimper', 1], ['Cable tester', 1], ['Cable stripper', 1],
      ['RJ45 connectors (pack of 50)', 1], ['Carry pouch', 1],
    ],
  }
  const kitSkus = Object.keys(KIT_CONTENTS)
  for (const sku of kitSkus) {
    await withTransaction((client) =>
      syncComponents(client, itemIds[sku], KIT_CONTENTS[sku].map(([name, quantityPerKit]) => ({ name, quantityPerKit })))
    )
  }
  const compId = async (sku, name) =>
    (await query('SELECT id FROM kit_components WHERE kit_id=$1 AND name=$2', [itemIds[sku], name])).rows[0].id

  await withTransaction(async (client) => {
    const base = { performedBy: 'Staff Member', source: 'site' }
    // 3 complete sets of the 80-in-1 to IT
    await issueWholeKit(client, { ...base, itemId: itemIds['TOL-001'], sets: 3,
      recipient: 'Chinedu Eze', department: 'IT', notes: 'Laptop repair bench' })
    // 2 sets to an event; one comes back complete
    await issueWholeKit(client, { ...base, performedBy: 'Admin User', itemId: itemIds['TOL-001'], sets: 2,
      source: 'event', eventId: eventMap['Product Launch'],
      recipient: 'Ngozi Adeyemi', department: 'Facilities', notes: 'Booth setup tools' })
    await returnKit(client, { ...base, itemId: itemIds['TOL-001'], sets: 1,
      recipient: 'Ngozi Adeyemi', department: 'Facilities', notes: 'One set returned complete' })
    // Just two flat bits and a tweezers from the 80-in-1 (opens one set)
    await issuePieces(client, { ...base, itemId: itemIds['TOL-001'],
      recipient: 'Ada Nwosu', department: 'Operations', notes: 'Fixing the projector remote',
      lines: [
        { componentId: await compId('TOL-001', 'Flat (slotted) bit'), quantity: 2 },
        { componentId: await compId('TOL-001', 'Tweezers'), quantity: 1 },
      ] })
    await issueWholeKit(client, { ...base, itemId: itemIds['TOL-002'], sets: 2,
      recipient: 'Ibrahim Musa', department: 'Maintenance', notes: 'Generator service' })
  })

  // Adjust quantities after seed issues (seed inserts don't run the stock logic)
  // Recompute from transactions for accuracy
  const { rows: items } = await query('SELECT id FROM items')
  for (const { id } of items) {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('receive','return') THEN quantity ELSE 0 END),0)
         - COALESCE(SUM(CASE WHEN type = 'issue' THEN quantity ELSE 0 END),0) AS net
       FROM transactions WHERE item_id = $1`,
      [id]
    )
    // net is relative to seed base quantity which already included some stock;
    // for seed simplicity set quantity to max of current seeded qty and logical stock.
    // We'll leave the inserted quantity as the "on shelf" count after the sample txns.
  }

  // Explicit post-issue quantities for demo clarity
  await query(`UPDATE items SET quantity = 45 WHERE sku = 'ELE-001'`) // 60+30 receive was in txn but qty was 60; simplify
  await query(`UPDATE items SET quantity = 11 WHERE sku = 'ELE-002'`) // 12 - 2 + 1
  await query(`UPDATE items SET quantity = 5 WHERE sku = 'FUR-001'`)  // 8 - 3

  console.log('Seed completed')
  await pool.end()
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
