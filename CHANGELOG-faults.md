# Update: faulty-item monitoring

## What's new
- **Faulty Items page** (`/faults`, sidebar): summary cards (open / usable with fault / out of service / resolved), filters,
  search, report / edit / resolve / reopen, CSV and PDF export with a "reported between" date range.
- **Usable-with-fault vs out-of-service.** A fault marked *usable* stays issuable and carries a "how to use it" note
  (e.g. extension cord with a missing socket: connect the bare ends directly). *Out of service* is flagged red.
- **Item page:** new Faults panel (open faults, resolved history, report button) and a fault badge by the name.
- **Issue Stock:** the chosen item's open faults and workarounds are shown before issuing. It never blocks an issue.
- **Inventory list / Dashboard / sidebar:** fault badges, an "open faults" banner and a count on the menu entry.
- **Reports & Exports:** new "Faulty items register" dataset; the complete JSON export includes `item_faults`.
- Kits: a fault can be recorded against a single piece.

## Safety
- New table `item_faults` only (created with `CREATE TABLE IF NOT EXISTS` by the normal startup migration; safe to re-run).
  No existing table, column, stock number or ledger line is touched. Faults never change quantities.
- New API `/api/faults/*`; delete is admin-only, everything else any signed-in user.
- Written-off faults only close the record; lower stock with *Edit item* if the item is discarded.

## Deploy
`docker compose up --build -d` (backend runs the migration on start; data in `pgdata` is kept).
Rollback: redeploy the previous zip. The extra table is ignored by older versions.
If you ever restore a backup taken before this update, restart the backend once so the table is recreated.

## Files
Backend: `routes/faults.js`, `index.js`, `services/exports.js`, `db/migrate.js`.
Frontend: `pages/FaultsPage.jsx`, `components/Fault*.jsx`, `ItemFaultsPanel.jsx`, `IssueFaultWarning.jsx`, `utils/faults.js`,
plus small edits to App, Layout, Dashboard, InventoryList, ItemDetail, IssueStock, ExportsPage, api.js.
