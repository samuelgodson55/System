# Return Stock update

## Everything that is out, in one view
- New **Everything out** tab on *Return Stock*: all outstanding stock across every item, by person or by item, with search, paging and live totals. Each line has a *Return* button; each person has *Return all*.
- *Return all* is a single all-or-nothing request (`POST /api/transactions/return-batch`) – no half-returned states if something fails. Kits return every set and piece still out. Consumables are excluded on purpose.
- New endpoint `GET /api/transactions/outstanding` (grouping, search, paging and summary done on the server).
- The old flow is kept as **Find by item**.

## Consumables can be returned
- The server no longer rejects consumable returns. The amount is capped at what that person was issued minus what they already returned, units/packs convert as usual, and stock goes back up.
- Return form for consumables asks for a reason (wrong item, issued by mistake, unused surplus, other), starts with an empty quantity, and warns that only unused goods should be restocked.
- After returning a consumable, *Issue something else to …* opens the Issue page with recipient and department pre-filled (the "I wanted face masks instead" case).

## Internals
- `ReturnStock.jsx` split into `components/returns/*` (overview, by-item lookup, kit form, simple form, return-all modal); shared helpers in `utils/returns.js`.
- Return logic shared in `services/returns.js`; overview in `services/outstanding.js`.

---

# Fixes in this version

## Units
- Ledger no longer records "5 cartons" for a base-unit quantity sent with a unit but no unit quantity; unit quantity is derived from the item's factor.
- Kit issue/return/receive no longer record a pack/carton unit (kits are counted in sets/pieces; the unit was never converted).
- Unit conversion factors are validated (0.0001 – 99,999,999). Previously 0.00001 was saved as 0 and 1e9 caused a 500 error.
- An item's base unit can't be changed once it has stock history (would silently corrupt every conversion).
- Return screen: "Return all" and the max value were in base units even when another unit was selected (e.g. returning 88 pcs as 88 cartons). Now unit-aware; falls back to base unit when the balance isn't a whole number of the chosen unit.

## Bugs
- Editing an item re-sent the stock number the form was opened with, overwriting receipts/issues made since. Stock is now only sent when changed.
- Recipient/department are trimmed server-side (return of "Bob " vs "Bob" failed).
- Issues now require a recipient, and an event when source = event (server-side, not just the form).
- Malformed ids / impossible dates (2026-02-31) returned 500; now 404 / 400.
- Staff could delete items and create/edit/delete units. These are now admin-only.

---

# Fix: "Failed to fetch" on Reports & Exports

**Cause:** in `frontend/nginx.conf` the exports block was `location /api/exports/` (trailing slash). The page's
catalogue request to `/api/exports` made nginx reply with a 301 to an absolute URL without the `:3000` port, so the
browser went to `localhost:80` and failed. Downloads (`/api/exports/<name>`) were unaffected.

**Fix (frontend container only; backend and database untouched):**
- `nginx.conf`: exports location has no trailing slash and proxies the URI as-is; `absolute_redirect off` added.
- `api.js`: catalogue is requested as `/exports/` (works with both old and new nginx config).

**Deploy:** `docker compose up --build -d frontend`. No data or schema change.
Rollback: redeploy the previous zip.
