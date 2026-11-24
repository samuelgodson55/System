# Item page: Unit Conversions fix

## Problem
The Unit Conversions card always printed the stock number as "N Pieces" (hard-coded), even when the
item is counted in another unit (e.g. Packs). Latex gloves: 248 pk showed "248 Pieces", and the
real Piece unit (1 Piece = 0.01 pk) was never converted.

## Fix (frontend only: `frontend/src/pages/ItemDetail.jsx`)
- Card now lists every unit enabled for the item, converted from the stock with the item's own factors
  (qty = stock / base-units-per-one-unit). The unit the item is counted in is first, highlighted, factor 1.
- 248 pk with 1 Carton = 10 pk, 1 Piece = 0.01 pk now shows: 248 Packs, 24.8 Cartons, 24,800 Pieces.
- Exact values show without "≈"; thousands separators; singular/plural handled.
- Items counted in pieces look as before.

## Safe to deploy
No backend, database or API change; no data touched. Rebuild frontend only:
`docker compose up --build -d frontend`. Rollback: redeploy previous zip.
