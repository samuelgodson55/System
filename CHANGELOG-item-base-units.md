# Items counted in litres / other units

Example: engine oil received in 208 L drums and issued 20 L at a time.

## What changed
- **Item form:** new *Counted in (base unit)* selector (Litre, kg, Piece …). Locked once the item has stock history.
- **Per-item factors:** for items not counted in pieces, each ticked unit needs its own factor (1 Drum = 208 L). The factor box shows the item's unit instead of "pcs".
- **Receive / Issue:** live line showing the conversion ("= 208 L will be added", "188 L will be left in store"). Quantities accept decimals (0.0001 and up). "Insufficient stock" now names the unit.
- **Labels:** hard-coded "pcs" on Inventory, Item page, Dashboard low-stock, Receive/Issue pickers and Event usage now show the item's own unit. Items counted in pieces still say "pcs" and look as before.
- **Quantity / reorder inputs** in the item form accept decimals (previously whole numbers only in the browser).
- **Units page:** help text explaining the litre/drum set-up.
- **API:** items now return `hasHistory`. Adding a unit to an item that is not counted in pieces without a factor returns `400`.

## Safe to deploy on the live system
- **No database migration, no schema change, no data rewritten.** The base-unit and per-item factor columns already existed.
- Existing items, ledger lines and balances are untouched; re-saving an existing item behaves as before.
- Old browser tabs keep working against the new API (all additions are optional fields).

## Deploy
```bash
docker compose up --build -d backend frontend
```
Rollback: redeploy the previous zip.

## Notes
- An item that already has history keeps its current base unit (e.g. an existing "Engine Oil" counted in pieces). To count it in litres, create a new item and move the stock across (receive it there, then issue the old stock out as an adjustment).
- The Dashboard "Units in Stock" total adds every item's stock number together, so it now mixes pieces and litres.
