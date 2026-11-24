# Update: editable categories and reusable recipients

## Categories
- **Inventory → Categories**, and **Rename / manage** inside the item form: rename a category (all its items follow), merge a mistyped
  one into the right one, add an empty one, remove one nothing uses.
- Renaming never touches stock, SKUs, last-updated dates or the ledger. A category in use cannot be removed.
- The item form follows a rename made while it is open, so saving does not bring the old name back. A category filter that was renamed
  resets itself instead of showing an empty list.

## Recipients
- Issue Stock: Recipient is a searchable drop-down of saved recipients (usual department offered on selection; department suggestions too).
- New recipients are added **while issuing** (saved together with the issue; a failed issue leaves nothing behind). Whole kits and single
  pieces are covered as well.
- **Edit name** under a saved recipient: correct the spelling or the usual department. A new name also renames them on past ledger lines so
  balances stay together; if the name already exists you are asked to merge.

## Safety (the site is live)
- Database: two new tables only (`categories`, `recipients`), created with `CREATE TABLE IF NOT EXISTS` by the normal start-up migration; safe to
  re-run. **No existing table, column, stock number or ledger line is changed at start-up.** Both lists fill themselves from existing items /
  ledger the first time they are opened.
- Ledger lines still hold recipient/department as text, so Return Stock, outstanding balances, exports and reports are unchanged.
- Old browser tabs keep working during the update: `/api/items/categories` is still served, and issue requests are unchanged.
- Writers take a fixed lock order (list lock, then item/ledger rows), so concurrent issues and renames cannot deadlock or create duplicates.
- Backup restore: restoring an older backup is fine; the recipient list is rebuilt from the restored ledger automatically.
- Permissions: any signed-in user can add / rename categories and recipients (needed for correcting mistakes while working); nothing here deletes
  data. Say if you want renames limited to admins.

## Deploy
1. (Recommended) take a backup first: Backups page → Create backup.
2. `docker compose up --build -d`  (backend runs the migration on start; the `pgdata` volume is kept).
3. Hard-refresh the browser once (Ctrl+F5).

Rollback: redeploy the previous zip. The two extra tables are ignored by the older version. Names changed through the new screens stay changed.

## Files
Backend: `db/migrate.js`, `services/categories.js`, `services/recipients.js`, `routes/categories.js`, `routes/recipients.js`,
`routes/items.js`, `routes/transactions.js`, `routes/backup.js`, `index.js`.
Frontend: `components/CategoryManagerModal.jsx`, `RecipientCombobox.jsx`, `RecipientEditModal.jsx`, `hooks/useRecipients.js`,
`pages/IssueStock.jsx`, `pages/InventoryList.jsx`, `components/ItemFormModal.jsx`, `context/InventoryContext.jsx`, `utils/api.js`.
