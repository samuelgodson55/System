# Staff permissions: no editing on the Inventory page

## What staff can still do (unchanged)
Add items, issue stock, receive stock, return stock, repack kits, record faults, view and export reports, add a category while creating an item.

## What is now admin-only
- **Editing an item** (name, SKU, category, units, stock figures, kit contents) – `PUT /api/items/:id`
- **Deleting an item** – already admin-only, unchanged
- **Renaming / merging / deleting categories** – `PUT` and `DELETE /api/categories/:id`

## How it is enforced
- **Server (the real protection):** the three routes above use the existing `requireAdmin` middleware and answer `403 Admin access required` to staff. Hiding buttons alone would not stop a direct API call.
- **Screens:** for staff the Edit / Delete buttons (Inventory list and item page) and the Categories manager are hidden; the item form refuses to open on an existing item and the "Rename / manage" link is removed from the Add Item form.

## Safe to deploy
No database changes, no new dependencies, no API shape changes. Admin behaviour is identical. Staff who still have an old page open will simply get a "403 Admin access required" message if they click Edit before refreshing.

## Deploy
Rebuild the frontend and backend images (`docker compose up -d --build`). No migration is needed.
