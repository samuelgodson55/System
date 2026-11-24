# PDF export now downloads a real PDF file

## Problem
"PDF" buttons opened a new tab and the browser's Print dialog (HTML + window.print()); nothing was downloaded.

## Fix (frontend only)
- `utils/export.js` `exportToPDF` now builds a genuine PDF with jsPDF + jspdf-autotable and saves it as
  `<name>_<date or range>.pdf`. Branding header, title, generated time, date range, repeating table header,
  and "Page x of y" footer are kept. Wide tables (more than 6 columns) use landscape A4.
- The libraries are loaded on demand (code-split), so the app's initial download is unchanged.
- Function signature is unchanged, so every page (Inventory, Item history, Daily Issues, Events, Dashboard,
  Return Stock, Units, Reports & Exports) gets the fix. It now returns a Promise and reports failures with an alert.
- `ServerExportButtons.jsx`: no longer opens a blank popup window first (no popup-blocker problems).
- Symbols outside the standard PDF fonts are swapped (arrow -> "to", naira sign -> "NGN", curly quotes -> plain).

## Safety
- No backend, database or API change. New packages: `jspdf`, `jspdf-autotable` (package.json + lockfile updated).
- Deploy: `docker compose up -d --build frontend` (the image build runs `npm install`, so it needs internet access).
  Roll back by redeploying the previous frontend image.

## Build speed (follow-up)
- `frontend/Dockerfile` ran `npm install` from package.json alone, so every rebuild re-resolved the whole
  dependency tree against the registry. It now copies `package-lock.json` and runs `npm ci` (locked
  versions, no resolution, no audit/fund calls, retries on flaky networks). Docker caches this layer, so
  later rebuilds that don't touch package files skip the install entirely.
- Only the FIRST build after this update has to download packages (jspdf is new); it is slow only on a
  slow connection. Nothing else changed.
