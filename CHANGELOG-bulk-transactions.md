# Bulk issue & bulk receive

Book many items in one go instead of one form per item.

## Where
- **Issue Stock → Bulk issue** tab: one recipient / department / purpose, many items.
- **Receive Stock → Bulk receive** tab: one source (vendor or head office) and notes, many items.
- The original single-item forms are unchanged and stay on the first tab (deep links such as
  `/issue?item=…` and `/issue?recipient=…` still open them). `/issue?mode=bulk` opens the bulk tab.

## Using it
1. Fill in the header (recipient + department, or vendor / head office).
2. Search by name or SKU and press **Enter** to add (a scanned / typed exact SKU adds straight away and the
   cursor jumps to its quantity; **Enter** again returns to the search for the next item).
   Or use **Paste a list**: one `SKU, quantity[, unit]` per line (names work too; Excel copy-paste works).
   Rows that cannot be matched are listed and skipped – nothing is guessed.
3. Pick a unit per line (only units enabled for that item are offered); the base-unit equivalent is shown.
4. **Review** → a confirmation summary → **Confirm**. A result screen lists what was booked and the new stock.

## Safety / best practices
- **All-or-nothing**: one database transaction. If any line is wrong (not enough stock, unit not allowed,
  item deleted …) nothing is saved and *every* problem is reported next to its line.
- **Server is the authority**: unit conversion and stock checks are re-done on locked rows; duplicate items are
  checked cumulatively; quantities are validated (> 0, bounded); max 200 lines per batch.
- **No deadlocks**: same lock order as the rest of the app (recipient list first, then items in id order).
- **Double-click / retry safe**: each batch carries a random request id; a repeat of a batch that already
  saved returns the original result instead of booking it twice (kept in memory for 15 minutes).
- **Same ledger as before**: each line is an ordinary `issue` / `receive` transaction, so history, Daily
  Issues, outstanding balances, Return Stock, exports, backups and delete-a-line all work unchanged.
- Kits that list their contents cannot be bulk-issued (their pieces must be traced) – use the single Issue tab.
  Receiving whole sets of a kit is allowed. Items with open faults show a warning badge on the line.
- Unsaved lists warn before the tab is closed or reloaded.

## API (new, additive)
- `POST /api/transactions/bulk-issue`   `{ requestId, recipient, department, source: site|event, eventId, notes, lines:[{ itemId, unitId?, unitQuantity }] }`
- `POST /api/transactions/bulk-receive` `{ requestId, source: vendor|head_office, vendor, notes, lines:[…] }`
- 201 `{ count, lines:[{ transactionId, itemId, itemName, sku, quantity, unitQuantity, newStock }], replayed }`;
  422 `{ error, lineErrors:[{ index, itemId, message }] }` when any line is rejected.

## Upgrade notes
- **No database migration, no new dependencies, no changes to existing endpoints or data.**
  Existing data and backups are untouched; rebuild and restart as usual
  (`docker compose up --build -d`). Rolling back = deploying the previous build.

## Files
- backend: `src/services/bulk.js`, `src/services/idempotency.js` (new); `src/routes/transactions.js` (two routes added)
- frontend: `src/components/bulk/BulkStockForm.jsx`, `src/utils/bulk.js` (new); `src/pages/IssueStock.jsx`,
  `src/pages/ReceiveStock.jsx` (tabs), `src/utils/api.js`, `src/context/InventoryContext.jsx` (`reloadItems`)
