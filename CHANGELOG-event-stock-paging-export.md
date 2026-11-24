# Event page: paged "Stock Used", its own exports, and "Event dates" fix

## What changed
- **Stock Used for this Event** is now paged (8 rows per page) using the shared Pagination component, so a long list no longer pushes the Transaction Log down. Totals and cards still count every row, not just the visible page. The page resets when you open another event and can never point past the last page.
- **CSV and PDF buttons** added to the Stock Used header. They export *all* rows (every page): Item, SKU, Type, Issued, Returned, Net Used, Unit, with the usual report overview (event status, dates, items used, total issued/returned/net). Buttons are disabled when nothing has been issued.
- **Event dates no longer overflow** the overview tile in the Transaction Log export. Raw timestamps (`2026-11-23T00:00:00.000Z to ...`) are now shown as `Nov 23, 2026` (or `Nov 23, 2026 to Nov 25, 2026`). Applies to both CSV and PDF.
- **PDF overview tiles are now overflow-proof for every report**: a long value shrinks, then wraps to at most two lines (tile gets slightly taller only when needed). Normal tiles look exactly as before.

## Changed files (frontend only)
- `src/pages/EventDetail.jsx`
- `src/utils/exportSummary.js` (new `eventDatesLabel` helper; existing functions untouched)
- `src/utils/export.js` (`drawOverview` only; function signatures unchanged)

## Safety
- No backend, database, API or package changes. Read-only display/export code. Existing Transaction Log export behaviour is unchanged apart from the date text.
- Deploy: `docker compose up -d --build frontend`. Roll back by redeploying the previous zip.
