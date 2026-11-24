# Update: one department per person + "stock with a department" view

## The problem
Abdulazeez Isyahu was first issued items under HVAC and later under Plumbing. Balances are tracked per
person + department, so he showed up as two people with two separate stock histories.

## Fixing the existing record (do this once)
1. Return Stock -> **Everything out**. An amber notice lists anyone whose records sit under more than one
   department. Click **Fix Abdulazeez Isyahu (HVAC / Plumbing)**.
   (Same dialog: Issue Stock -> pick the person -> **Edit name / department**.)
2. Set **Usual department** to **Plumbing**. The dialog shows how many records are under each department.
3. Leave "Also move N past records to Plumbing" ticked, then Save.
Everything he holds is now one history under Plumbing. Only the department label on those records changes -
no quantities, dates, items or stock levels. The change is written to a new `recipient_audit` table (who, when, old -> new).

## Preventing it happening again
- A saved recipient has ONE department. Issue Stock and Bulk issue fill it in and lock the field
  (change it via Edit). The server enforces this too: a different department typed/sent for an existing
  person is ignored and the saved one is used. Old open browser tabs are covered by this.
- A department typed in a different capitalisation ("plumbing") re-uses the saved spelling.
- A person with no saved department still gets the one typed first.

## Stock held by a department
Return Stock -> Everything out:
- **Group: By department** - one card per department listing every item and who has it (Return buttons work as before).
- **Department filter** (drop-down, with people counts) - combines with Expected back / Consumables / Everything and search.
- The CSV/PDF export button follows the department filter.

## Safety (the site is live)
- Database: one new table (`recipient_audit`, CREATE TABLE IF NOT EXISTS, run by the normal start-up migration). No existing table/column changed.
- Nothing is rewritten automatically. Existing records only change when you press Save in the Fix dialog.
- New endpoints are additive: `GET /api/recipients/conflicts`, `GET /api/recipients/:id/usage`; `PUT /api/recipients/:id` accepts `applyToHistory` (default true when a department is set).
- Rollback: redeploy the previous zip; the extra table is ignored. Corrected departments stay corrected.

## Deploy
1. Backups page -> Create backup (recommended).
2. `docker compose up -d --build`   (keeps the `pgdata` volume)
3. Hard-refresh the browser (Ctrl+F5).

## Files
Backend: db/migrate.js, services/recipients.js, services/outstanding.js, services/exports.js, routes/recipients.js
Frontend: components/RecipientEditModal.jsx, RecipientCombobox.jsx, returns/OutstandingOverview.jsx, returns/OutstandingDetailModal.jsx,
components/bulk/BulkStockForm.jsx, pages/IssueStock.jsx, utils/api.js
