# Edit Item: quantity field now shows (and saves) the TOTAL owned

## Problem
Edit Item showed the in-store (available) count in "Quantity". An item with total 1, all issued out,
showed 0 in Edit while the list showed Total 1. Saving a changed figure treated it as the in-store
count, so totals drifted from what was entered.

## Fix
- Frontend (`ItemFormModal.jsx`): non-kit items now open with `totalQuantity` (in store + out), labelled
  "Total quantity", with a hint showing how many are issued out. Sends `totalQuantity` only when changed.
- Backend (`routes/items.js` PUT): when `totalQuantity` is sent, in-store = total - currently outstanding,
  calculated inside the existing row lock (safe against issues/returns while the form was open).
  A total below what is out is rejected (409) with a clear message.
- Kits unchanged (already used total sets). Creating items unchanged.

## Safety
- No migration, no schema change, no data rewritten. Old `quantity` field is still accepted by the API,
  so a browser tab running the old frontend keeps working during deploy.
- Deploy: `docker compose up -d --build backend frontend` (backend first is fine). Roll back by
  redeploying the previous images.
