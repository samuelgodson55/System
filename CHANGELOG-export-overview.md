# Exports now open with a report overview

## Problem
Exports started straight into the table. Management had to count rows to learn basics such as how many SKUs are in store.

## What every export now shows first
- **Report name, company/site, generated time, date range and the filters used** (e.g. "Category: Tools", "Low stock only", "None (all items)").
- **Report overview** – headline figures for that report:
  - Inventory: Total SKUs in store, consumables / reusable / kits, kit pieces listed, categories, low stock, out of stock, items currently issued out.
  - Low stock, Kit contents, Stock currently out, Transaction ledger, Events, Stock per event, Faults register, Units, Users: figures suited to each (e.g. recipients holding stock, oldest open fault, received/issued/returned counts and first/latest movement).
  - Daily Issues, Item history, Event stock: transaction counts, recipients, departments, first/latest movement, etc.
- **PDF**: figures are drawn as tiles above the table; kits are bold with their pieces visibly secondary beneath them; every page footer carries the report name beside "Page x of y".
- **CSV**: the same information as a block of lines above the table (the table header follows a blank line, as before).

## Changed files
- Frontend: `utils/export.js` (overview + kit row styling, same function signatures; new optional options `title`, `summary`, `filters`, `rowKinds`), new `utils/exportSummary.js`, `components/ServerExportButtons.jsx`, pages `InventoryList`, `DailyIssues`, `ItemDetail`, `EventDetail`.
- Backend: `services/exports.js` (overview + filter description; ledger filter shared, behaviour unchanged), `routes/exports.js`. JSON responses gain `overview` and `filters` (existing fields untouched).

## Safety
- No database change, no migration, no new packages. Read-only code only. An overview failure is caught and simply leaves the overview out; it can never block a download.
- Overview figures are computed from the full result set (not the PDF row cap); the ledger uses one aggregate query so memory stays flat.
- **One behaviour to know:** server CSVs (Reports & Exports page) now begin with the overview lines, like the browser-built CSVs already did. Anything that imports those CSVs by machine should call the endpoint with `overview=0` to get the plain header + rows file.
- Deploy: `docker compose up -d --build backend frontend`. Roll back by redeploying the previous zip.
