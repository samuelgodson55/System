# Update: exports everywhere

## Added
- `backend/src/services/exports.js`, `backend/src/routes/exports.js` – read-only export API (mounted at `/api/exports`).
- Frontend: `ServerExportButtons`, `ExportsPage` (`/exports`, sidebar "Reports & Exports"), export buttons on Dashboard (low stock, ledger), Return Stock (stock currently out), Events, Units.
- Existing client-side CSV now also writes a UTF-8 BOM and CRLF, and downloads reliably in Firefox.

## Changed (small)
- `backend/src/index.js`: registers the route; CORS exposes `Content-Disposition`.
- `frontend/nginx.conf`: unbuffered, 300 s proxy for `/api/exports/`; gzip for `text/csv`.

## Migration
None. No schema change, no new packages. Rebuild the images (`docker compose up --build -d`); data in the `pgdata` volume is not touched. Roll back by redeploying the previous zip.
