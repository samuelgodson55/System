# Kit stock consistency

No database migration. No existing data is modified on deploy. API responses only gain fields.

## What the "3 vs 2 sets" screen was showing
`In store` for a kit piece = (complete sets x per-set) + loose pieces. With 2 complete sets and
1 loose piece that is 3 - correct arithmetic, but the screen never said so, and the header said
"0 out" while 3 pieces were out (it only counted whole sets).

## Fixes
- **Auto-repack.** When pieces come back (return, return-all, received replacements) and a full
  set's worth is loose, they now snap into complete sets in the same transaction. Previously this
  needed a manual "Repack" click. The manual button/endpoint remains for pieces already loose.
- **Item history now refreshes** after piece-only changes. Loose-piece changes never touched the
  kit's `updated_at`, so the history on the item page was not reloaded.
- **Clear counts.** Kit header shows "N sets out - N pieces out - N loose pieces in store"; the
  In store column shows "x in sets + y loose"; a one-line explainer sits under the table.
  Inventory list shows "N pcs out" under Issued Out for kits.
- Return banner says when stock was repacked automatically.

## API additions (backwards compatible)
- Item: `piecesOut`.
- `POST /transactions/kit-return`, `kit-receive`: `autoRepacked` (sets formed).

## Files
backend: services/kits.js, routes/items.js
frontend: pages/ItemDetail.jsx, pages/InventoryList.jsx, pages/ReturnStock.jsx, components/returns/KitReturnForm.jsx

- Edit form (kits): a warning under "Complete sets in store" reminds that an opened set is not a complete set, showing loose / out piece counts.
- frontend also: components/ItemFormModal.jsx

## Edit Item: "Total sets owned"
- For kits, the Edit Item quantity is now **Total sets owned** (every set you own, including opened
  or issued-out ones) instead of "Complete sets in store". Complete sets on the shelf are worked
  out automatically; the kit page shows "N owned in total".
- Server: item has `totalSets`; `PUT /items/:id` accepts `totalSets` for kits and adjusts the shelf
  count by the difference (loose pieces and issued pieces untouched). Refused (409) if the total is
  lower than the sets already opened or out. Old browsers sending `quantity` keep working.
- New kits: the number entered is the total (nothing is opened or out yet).
- Files: services/kits.js, routes/items.js, components/ItemFormModal.jsx, pages/ItemDetail.jsx
