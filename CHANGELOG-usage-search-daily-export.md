# Search in "Stock Used" and "Totals by item", plus Daily Issues item exports

## What changed
- **Event page > Stock Used for this Event**: new search bar (item name, SKU, type, kit piece name; multi-word, any order). While searching it shows "N of M items" and, when the matches share one unit, the combined net used. Paging follows the search; CSV/PDF export what is filtered (the filter is noted in the report). Summary cards at the top still count the whole event.
- **Daily Issues > Totals by item**: new search bar with the same behaviour, plus **CSV and PDF buttons in that card** exporting the items used that day (SKU, Item, Type, Entries, Total issued, Unit). Exports cover all pages and respect the page search and this search. The existing header exports (full issue log) are unchanged.
- Empty-match state with a "Clear search" link. Search resets when you change event or day.

## Changed files (frontend only)
- `src/pages/EventDetail.jsx`, `src/pages/DailyIssues.jsx`
- `src/utils/usageSearch.js` (new, pure helpers)

## Safety
No backend, database, API or package changes; read-only display/export code. Deploy: `docker compose up -d --build frontend`. Roll back by redeploying the previous zip.
