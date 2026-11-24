# Kits: "Total Qty" now counts every set you own

## Problem
Total Qty for a kit was computed as complete sets on the shelf + whole sets issued out. A set that was
opened (some pieces issued, others loose) was in neither number, so 2 owned Kanier sets showed "1".

## Fix (backend, read-only calculation)
- `routes/items.js` `mapItem`: for kits `totalQuantity` now equals `totalSets` (the same "N owned in
  total" figure already used on the kit page and Edit Item form: shelf + opened + issued).
- Non-kit items are unchanged (available + outstanding).
- Piece rows (Total = in store + out, in pieces) were already correct and are unchanged.

## Safety
- No migration, no data written, no schema or API shape change (same field, corrected value).
- Deploy: `docker compose up -d --build backend`. Roll back by redeploying the previous backend.
