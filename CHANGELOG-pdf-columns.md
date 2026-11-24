# PDF notes layout fix + customisable report columns

## Problem
- Wide PDFs (the 19-column Transaction ledger) were squeezed onto one A4 page, so the Notes column collapsed to a
  one-letter-wide strip (text ran vertically) and dates / IDs broke mid-word.
- No way to choose which columns appear in a report.

## Fix: PDF layout (`frontend/src/utils/export.js`, affects every PDF in the app)
- Column widths are now calculated from the content: every column is at least as wide as its longest word/header
  (no mid-word breaks); short columns keep their natural width and long text (Notes) gets the spare room.
- Paper size follows the column count: A4 portrait (<=5), A4 landscape (<=12), A3 landscape (more). If it still
  does not fit, the font steps down (8.5pt to 5.5pt) instead of crushing columns.
- Cell text is tidied (extra spaces/blank lines trimmed); transaction IDs wrap at a hyphen onto two lines.
- Function signature unchanged, so Inventory, Item history, Daily Issues, Events and all report pages benefit.

## New: choose report columns (server-built reports)
- Backend: `GET /api/exports/:dataset` accepts optional `columns=key1,key2` (CSV and JSON). Unknown keys return 400;
  dataset column order is kept; omitted = all columns exactly as before. The catalogue (`GET /api/exports/`) now also
  returns `columnDefs` (key + label) and `pdfDefault`; the existing `columns` field is unchanged.
- Frontend: every place that uses `ServerExportButtons` (Reports & Exports, Dashboard ledger, Activity, Events, Faults,
  Units, Stock currently out, ...) gets a **Columns** button next to CSV / PDF with Select all / Reset.
  The choice is remembered per report in the browser (localStorage `export_columns:<report>`) and validated against the
  current column list, so it can never break an export.
- Defaults when nothing is chosen: CSV = all columns (unchanged). PDF of the Transaction ledger = compact set (drops
  Quantity (base), Base Unit and Transaction ID). Pick them in Columns to include them.
- The Inventory page keeps its existing Columns picker (already used by its CSV/PDF).

## Safety
- No database change, no migration, no new packages. Read-only endpoints; old clients keep working.
- Deploy: `docker compose up -d --build backend frontend`. Roll back by redeploying the previous zip.
- Not changed: Daily Issues, Item history and Event stock exports still have fixed columns (layout fix applies).
