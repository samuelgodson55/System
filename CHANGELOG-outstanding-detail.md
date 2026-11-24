# Return Stock → "Everything out": full per-person detail + bounded cards

## Fixed
- Pieces of a tool kit (e.g. the "3 pieces out" of a screwdriver set) were only visible as a
  truncated one-line summary. Clicking a person's name (or an item's name when grouped
  **By item**) now opens a dialog listing **every** line they have out, with each kit piece
  named in full (e.g. "1 × 6 mm Combination Spanner").
- The dialog has the same Return button per line and "Return all (n)". Returning from it
  closes the dialog and opens the normal return flow, so all return rules are unchanged.

## "Everything out" is not an endless scroll
- Groups (people/items) were already server-paginated, 6 per page (`limit` capped at 50 by the API).
- Added: each card now previews at most 5 lines, then a "View all N items" link opens the detail
  dialog. A person with dozens of issued items no longer produces an ever-growing card.
- Result: page height is bounded (6 cards x 5 lines max) however much accumulates; the rest is
  reachable via the pager and the detail dialog (which scrolls inside itself).

## Safety
- Frontend only. No backend, API, database or schema changes; exports and return logic untouched.
- New: components/returns/OutstandingDetailModal.jsx, OutstandingQuantity.jsx (moved out of the
  overview unchanged so both views share it).
- Edited: components/returns/OutstandingOverview.jsx.
- Deploy: `docker compose up -d --build frontend`. Roll back by redeploying the previous frontend.
