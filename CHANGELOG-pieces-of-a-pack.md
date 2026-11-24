# Items counted in packs, issued in packs *or* pieces (exact conversion)

## Problem
"DC SOFT Toilet Tissue" is counted in **packs** but is sometimes issued in **pieces** (1 pack = 48 pieces).
A piece is 1/48 of a pack = 0.0208333...; the app stored every conversion factor and every stock
quantity with only **4 decimals**, so a piece became **0.0208** and the maths drifted:
6 packs showed as **288.46 pieces** (should be 288), and 48 pieces issued took 0.9984 pack, not 1.

## Fix (best practice: exact inverse, enough precision, no rounding drift)
1. **Exact "N per pack" (the inverse).** A unit that is a *part* of the item's base unit is now stored
   as how many make one base unit (**48 Pieces = 1 pack**). The server converts with `1 / 48`
   directly, never through a rounded decimal.
2. **More precision.** Stock, ledger quantities and per-item factors are now stored with 10 decimals
   (were 4). Existing values are unchanged.
3. **No drift.** After every issue / receive / return / bulk line / ledger delete, the stock is snapped
   back onto the item's smallest-unit grid (whole pieces) when it is within rounding dust, and checks
   such as "insufficient stock" / "cannot return more than outstanding" ignore dust below 0.000001.
   48 single pieces issued one by one from 5 packs leave exactly 4 packs.
4. **Item form.** For an item that is not counted in pieces, each extra unit now has a
   *larger than / smaller than* choice: `1 Carton = [10] pk` or `[48] Piece = 1 pk`.
5. **Item page.** "Available in store" also shows the split, e.g. `= 5 pk 43 pc`, and the Unit
   Conversions card shows exact numbers (6 Packs = 288 Pieces).

## What you do for DC SOFT Toilet Tissue (one minute, no data change)
Open the item -> **Edit**. The Piece row will already show **48 Piece = 1 pk** (the form recognises the
old 0.0208 as 1/48 and fills it in). Check it, press **Save**. Done: base unit stays **Packs**, and you
can issue in Packs or Pieces. Do the same for any other item where you typed a fraction such as 0.0208 or 0.0833
(the form pre-fills those too).

## Safe to deploy on the live system
- **Additive migration, runs automatically on start** (`migrate.js`, safe to run repeatedly):
  adds `item_units.units_per_base` and widens `items.quantity`, `transactions.quantity`,
  `item_units.conversion_factor` from `NUMERIC(…,4)` to `NUMERIC(22,10)`. No row is rewritten with a
  different value; stock, history, returns and exports show the same numbers as before.
- **Nothing changes until you save an item** with an "N per pack" unit; items that do not use it
  behave exactly as before (piece-based items, litres/drums, kits).
- Old browser tabs keep working: an old tab saving an item will not undo an exact "N per pack" setting.
- Quantities in reports / API are tidied to 8 decimals so rounding dust never shows (0.9999999984 -> 1).
- Tested against a copy of the old database (upgrade, then issue/receive/return/bulk/delete in packs,
  pieces and cartons), on a fresh install, and by running the migration twice.

## Deploy
```bash
docker compose up --build -d backend frontend
```
(Optional but sensible first: Backups page -> **Create Backup**.)
Rollback: redeploy the previous zip. The widened columns are compatible with the old code.

## Files
Backend: `db/migrate.js`, `services/itemUnits.js`, `routes/items.js`, `routes/transactions.js`,
`services/bulk.js`, `services/returns.js`, `services/outstanding.js`, `services/mappers.js`, `services/exports.js`.
Frontend: `utils/units.js`, `components/ItemUnitsPicker.jsx`, `components/ItemFormModal.jsx`,
`components/returns/SimpleReturnForm.jsx`, `components/bulk/BulkStockForm.jsx`,
`context/InventoryContext.jsx`, `pages/ItemDetail.jsx`, `pages/IssueStock.jsx`.
