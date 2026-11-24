# Receive Stock: receipt history

## Added
- **Receipt history panel** under the Receive Stock form (new `components/ReceiptHistory.jsx`):
  - Shows every past receipt: item (or kit piece), quantity + unit, Vendor/Head Office (with vendor name),
    date/time, who recorded it and any notes. 8 per page, server-side paging.
  - **No item selected:** all receipts, newest first, with a search box (item, SKU, vendor, notes, recorded by).
  - **Item selected:** switches to "Previous receipts of this item" so you can see what/when/from whom it was last received
    (helps avoid double-entering a delivery).
  - **Receive again** on a row selects that item and pre-fills Source/Vendor from that receipt.
  - Reloads automatically after each successful receipt; manual refresh button too.

## Backend (backwards compatible, no DB migration)
- `GET /api/transactions` accepts an optional `search` text filter (item name/SKU, kit piece, vendor, recipient, notes,
  recorded by; `%`/`_` matched literally, max 100 chars). Without it the endpoint behaves exactly as before.

## Files changed
- backend/src/routes/transactions.js
- frontend/src/pages/ReceiveStock.jsx
- frontend/src/components/ReceiptHistory.jsx (new)

## Deploying
`docker compose up -d --build`. No schema/data changes; roll back by redeploying the previous version.
