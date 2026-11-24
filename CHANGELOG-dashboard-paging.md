# Dashboard: low-stock "View all" fix + server-side paging

## Fixed
- **Low Stock Alerts → "View all"** opened the full inventory. It now opens
  `/inventory?lowStock=1`, i.e. the inventory page filtered to items at/below their reorder level.
  A "Low stock only" toggle on the Inventory page shows/clears the filter (it lives in the URL, so it
  is bookmarkable and survives refresh). Exports from that page respect the filter.

## Added
- **Server-side pagination (5 rows) on both dashboard sections** — Low Stock Alerts and Recent Activity
  fetch only the visible page from the server and each has its own pager (hidden when there is one page).
- **Recent Activity → "View all"** → new `/activity` page: full ledger, 20 per page (server-side),
  filter by Received / Issued / Returned, plus CSV/PDF export.
- `components/ActivityRow.jsx` — one shared row used by the dashboard and the Activity page.

## Backend (backwards compatible, no DB migration)
- `GET /api/transactions` accepts an optional `withTotal=1`. With it the response is
  `{ transactions, total, limit, offset }`; **without it the response is the same plain array as before**,
  so every existing screen keeps working.
- `GET /api/items` already supported `lowStock`, `page`, `limit` and `total` — unchanged.

## Files changed
- backend/src/routes/transactions.js
- frontend/src/pages/Dashboard.jsx, InventoryList.jsx, ActivityPage.jsx (new)
- frontend/src/components/ActivityRow.jsx (new)
- frontend/src/App.jsx (route `/activity`)

## Deploying
Rebuild both images (`docker compose up -d --build`). No data/schema changes, so it is safe to roll back
by redeploying the previous version.

## Follow-up fix: "All activity" showed no rows
- `api.getTransactions` / `api.getItems` built their query string with `URLSearchParams`, which sends an
  `undefined` value as the text `undefined`. With "All activity" the page sent `type=undefined`, so the
  server matched nothing. Both helpers now use the existing `qs()` helper (drops undefined/empty values),
  and the Activity page only sends `type` when a filter is chosen.
- Files: frontend/src/utils/api.js, frontend/src/pages/ActivityPage.jsx
